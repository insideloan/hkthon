"""BACKEND-003 (#22) — queue resolver."""

from __future__ import annotations

import pytest

from orchestrator.api import dynamo
from orchestrator.handler import OrchestratorError
from orchestrator.resolvers import queue

from ._fake_dynamo import FakeTable


@pytest.fixture(autouse=True)
def _fake_table():
    dynamo.set_table(FakeTable())
    yield
    dynamo.set_table(None)


def _seed_queue_row(call_id, **kw):
    item = {"PK": "QUEUE", "SK": f"CALL#{call_id}", "callId": call_id}
    item.update(kw)
    dynamo.put_item(item)


def test_queue_returns_summary_and_rows():
    _seed_queue_row("a", state="IN_CALL", churn_risk=30)
    _seed_queue_row("b", state="TRANSFER_PENDING")
    _seed_queue_row("c", state="IN_CALL", fraud_suspected=True)
    res = queue.resolve_queue({}, {})
    assert res["summary"]["total"] == 3
    assert res["summary"]["needsAgent"] == 1      # b
    assert res["summary"]["fraudSuspected"] == 1  # c
    assert res["summary"]["inCall"] == 2          # a, c
    assert {r["callId"] for r in res["rows"]} == {"a", "b", "c"}


def test_queue_highlight_only():
    _seed_queue_row("a", state="IN_CALL")
    _seed_queue_row("b", state="TRANSFER_PENDING")
    res = queue.resolve_queue({}, {"highlightOnly": True})
    assert [r["callId"] for r in res["rows"]] == ["b"]
    assert res["rows"][0]["highlight"] == "needs_agent"


def test_queue_row_schema():
    _seed_queue_row("a", state="IN_CALL", customer_name="박서준", churn_risk=44,
                    channel="agent", assignee="김상담")
    row = queue.resolve_queue({}, {})["rows"][0]
    for k in ("callId", "customerName", "state", "churnRisk", "assignee",
              "channel", "elapsedSec", "highlight"):
        assert k in row


def _seed_meta(call_id, **kw):
    item = {"PK": f"CALL#{call_id}", "SK": "META", "callId": call_id}
    item.update(kw)
    dynamo.put_item(item)


def test_queue_fallback_scans_meta_when_index_empty():
    # 큐 인덱스 비었을 때 CALL#/META 스캔으로 활성 콜 복원 (booth 콜드스타트).
    _seed_meta("live1", state="IN_CALL", startedAt="2026-06-22T00:00:00Z")
    _seed_meta("pend1", state="TRANSFER_PENDING")
    _seed_meta("new1", state="CREATED")  # 발신 전 → 큐에서 제외
    res = queue.resolve_queue({}, {})
    assert {r["callId"] for r in res["rows"]} == {"live1", "pend1"}
    assert res["summary"]["needsAgent"] == 1  # pend1


def test_queue_index_takes_precedence_over_meta():
    # 인덱스가 있으면 META 스캔은 하지 않는다 (핫패스).
    _seed_queue_row("idx1", state="IN_CALL")
    _seed_meta("meta1", state="IN_CALL")
    res = queue.resolve_queue({}, {})
    assert {r["callId"] for r in res["rows"]} == {"idx1"}


def test_queue_fallback_reads_camel_started_at():
    _seed_meta("c1", state="IN_CALL", startedAt="2026-06-22T00:00:00Z")
    row = queue.resolve_queue({}, {})["rows"][0]
    assert row["elapsedSec"] >= 0


def test_delete_queue_row_removes_index_and_meta():
    _seed_queue_row("a", state="IN_CALL")
    _seed_meta("a", state="IN_CALL")
    res = queue.resolve_delete_queue_row({}, {"callId": "a"})
    assert res == {"ok": True, "callId": "a"}
    # 인덱스/META 모두 삭제 → 큐 비어야 함(META fallback도 되살리지 않음).
    assert queue.resolve_queue({}, {})["rows"] == []
    assert dynamo.get_item(dynamo.pk_call("a"), dynamo.SK_META) is None


def test_delete_queue_row_clears_active_call_pointer():
    _seed_meta("a", state="DIALING", customerId="cust-1")
    dynamo.put_item({"PK": "CUST#cust-1", "SK": "ACTIVE_CALL", "callId": "a"})
    queue.resolve_delete_queue_row({}, {"callId": "a"})
    assert dynamo.get_item("CUST#cust-1", "ACTIVE_CALL") is None


def test_delete_queue_row_keeps_pointer_for_other_call():
    # 고객의 활성콜 포인터가 다른 콜을 가리키면 보존한다.
    _seed_meta("a", state="ENDED", customerId="cust-1")
    dynamo.put_item({"PK": "CUST#cust-1", "SK": "ACTIVE_CALL", "callId": "b"})
    queue.resolve_delete_queue_row({}, {"callId": "a"})
    ptr = dynamo.get_item("CUST#cust-1", "ACTIVE_CALL")
    assert ptr and ptr["callId"] == "b"


def test_delete_queue_row_idempotent_for_missing_call():
    res = queue.resolve_delete_queue_row({}, {"callId": "ghost"})
    assert res == {"ok": True, "callId": "ghost"}


def test_delete_queue_row_rejects_protected_call():
    # 시연 보호 행(c-demo-01)은 직접 호출로도 삭제 불가 — 행이 그대로 남는다.
    protected = next(iter(queue.PROTECTED_CALL_IDS))
    _seed_queue_row(protected, state="DIALING")
    _seed_meta(protected, state="DIALING")
    with pytest.raises(OrchestratorError) as exc:
        queue.resolve_delete_queue_row({}, {"callId": protected})
    assert exc.value.error_type == "FORBIDDEN"
    # 인덱스/META 모두 보존되어 큐에 그대로 보인다.
    assert {r["callId"] for r in queue.resolve_queue({}, {})["rows"]} == {protected}
    assert dynamo.get_item(dynamo.pk_call(protected), dynamo.SK_META) is not None
