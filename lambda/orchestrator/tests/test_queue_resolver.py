"""BACKEND-003 (#22) — queue resolver."""

from __future__ import annotations

import pytest

from orchestrator.api import dynamo
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
