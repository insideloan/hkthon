"""BACKEND #23/#24/#25 — calls resolver (dialCall/createCall/call/액션4종)."""

from __future__ import annotations

import pytest

from orchestrator.api import dynamo
from orchestrator.handler import OrchestratorError
from orchestrator.resolvers import calls, queue

from ._fake_dynamo import FakeTable


@pytest.fixture(autouse=True)
def _fake_table():
    dynamo.set_table(FakeTable())
    yield
    dynamo.set_table(None)


# ── dialCall ──────────────────────────────────────────────────────────────────


def test_dial_call_creates_dialing():
    out = calls.resolve_dial_call({}, {"customerId": "cust1"})
    assert out["state"] == "DIALING"
    assert out["customerId"] == "cust1"
    stored = dynamo.get_item(dynamo.pk_call(out["id"]), "META")
    assert stored["state"] == "DIALING"


def test_dial_call_rejected_when_connected():
    """이미 연결된(IN_CALL/TRANSFER_PENDING) 콜이 있으면 재발신 거부."""
    first = calls.resolve_dial_call({}, {"customerId": "cust1"})
    dynamo.update_fields(dynamo.pk_call(first["id"]), "META", {"state": "IN_CALL"})
    with pytest.raises(OrchestratorError) as ei:
        calls.resolve_dial_call({}, {"customerId": "cust1"})
    assert ei.value.error_type == "INVALID_STATE"


def test_dial_call_supersedes_stale_dialing():
    """묵은 DIALING(연결 안 됨) 콜은 종료하고 재발신을 진행한다.

    DIALING 으로 남은 콜은 ACTIVE_CALL 인덱스를 영구히 잠가 재발신을 막으므로,
    다시 발신하면 묵은 콜을 ENDED 처리하고 새 콜을 만든다.
    """
    # 묵은 DIALING 콜 + 활성 인덱스를 고정 id 로 시드 (new_call_id 는 ms 기반이라
    # 같은 ms 안의 연속 발신은 id 가 충돌하므로 시간에 의존하지 않게 직접 구성).
    stale_id = "c-stale-0001"
    dynamo.put_item({
        "PK": dynamo.pk_call(stale_id), "SK": "META",
        "callId": stale_id, "customerId": "cust1", "state": "DIALING",
    })
    dynamo.put_item({
        "PK": dynamo.pk_cust("cust1"), "SK": "ACTIVE_CALL", "callId": stale_id,
    })

    second = calls.resolve_dial_call({}, {"customerId": "cust1"})
    # 새 콜이 생성되고 DIALING 으로 발신된다.
    assert second["state"] == "DIALING"
    assert second["id"] != stale_id
    # 묵은 콜은 ENDED 처리된다.
    assert dynamo.get_item(dynamo.pk_call(stale_id), "META")["state"] == "ENDED"
    # 활성 콜 인덱스는 새 콜을 가리킨다.
    active = calls._active_call_for_customer("cust1")
    assert active["callId"] == second["id"]


def test_create_call_does_not_dial():
    out = calls.resolve_create_call({}, {"customerId": "cust1"})
    assert out["state"] == "CREATED"
    # createCall은 활성콜 인덱스를 만들지 않으므로 이후 dialCall 가능.
    assert calls._active_call_for_customer("cust1") is None


# ── call snapshot query ─────────────────────────────────────────────────────────


def test_call_query_not_found():
    with pytest.raises(OrchestratorError) as ei:
        calls.resolve_call({}, {"id": "nope"})
    assert ei.value.error_type == "NOT_FOUND"


def test_call_query_snapshot_shape():
    call = calls.resolve_dial_call({}, {"customerId": "cust1"})
    cid = call["id"]
    # 분석 스냅샷 + 토큰 포함 턴 1개 기록.
    dynamo.update_fields(dynamo.pk_call(cid), "META", {
        "strategy_headline": "대환 비교 제안", "rationale": "금리 절감 강조",
        "churn_risk": 62, "emotion": "불안",
    })
    dynamo.put_item({
        "PK": dynamo.pk_call(cid), "SK": dynamo.sk_turn(1), "seq": 1,
        "speaker": "customer", "text": "금리가 너무 높아요", "flag": "risk",
        "tokens": [{"text": "높아요", "polarity": "CONS", "reason": "가격저항"}],
    })
    snap = calls.resolve_call({}, {"id": cid})
    assert snap["analysis"]["strategyHeadline"] == "대환 비교 제안"
    assert snap["analysis"]["rationale"] == "금리 절감 강조"
    assert snap["analysis"]["churnRisk"] == 62
    assert snap["analysis"]["emotion"] == "불안"
    # aiAction/data 폐기 확인
    assert "aiAction" not in snap["analysis"]
    assert "data" not in snap["analysis"]
    assert snap["transcript"][0]["tokens"][0]["polarity"] == "CONS"
    assert snap["transcript"][0]["flag"] == "risk"


# ── 콜 액션 4종 ─────────────────────────────────────────────────────────────────


def _make_call(state="IN_CALL"):
    out = calls.resolve_dial_call({}, {"customerId": "cust1"})
    dynamo.update_fields(dynamo.pk_call(out["id"]), "META", {"state": state})
    return out["id"]


def test_transfer_to_agent():
    cid = _make_call()
    out = calls.resolve_transfer_to_agent({}, {"callId": cid})
    assert out["state"] == "TRANSFER_PENDING"


def test_send_link_records():
    cid = _make_call()
    out = calls.resolve_send_link({}, {"callId": cid, "url": "https://x"})
    assert out["ok"] and out["url"] == "https://x"
    assert dynamo.get_item(dynamo.pk_call(cid), "META")["link_sent_url"] == "https://x"


def test_approve_product():
    cid = _make_call()
    out = calls.resolve_approve_product({}, {"callId": cid, "productId": "p1"})
    assert out["ok"] and out["productId"] == "p1"


def test_end_call_sets_ended_and_writes_summary():
    cid = _make_call()
    out = calls.resolve_end_call({}, {"callId": cid})
    assert out["state"] == "ENDED"
    # 요약 write path 트리거 확인.
    assert dynamo.get_item(dynamo.pk_call(cid), "SUMMARY") is not None


def test_action_on_ended_is_invalid_state():
    cid = _make_call(state="ENDED")
    for fn, extra in [
        (calls.resolve_approve_product, {"productId": "p"}),
        (calls.resolve_transfer_to_agent, {}),
        (calls.resolve_send_link, {"url": "u"}),
        (calls.resolve_end_call, {}),
    ]:
        with pytest.raises(OrchestratorError) as ei:
            fn({}, {"callId": cid, **extra})
        assert ei.value.error_type == "INVALID_STATE"


# ── 큐 인덱스 갱신 (queue resolver 스냅샷 소스) ──────────────────────────────────


def _queue_index_row(call_id):
    item = dynamo.get_item(dynamo.PK_QUEUE, dynamo.sk_call(call_id))
    return item


def test_dial_call_writes_queue_index():
    out = calls.resolve_dial_call({}, {"customerId": "cust1"})
    idx = _queue_index_row(out["id"])
    assert idx is not None
    assert idx["state"] == "DIALING"
    # queue resolver가 인덱스에서 행을 본다 (META 스캔 fallback 불필요).
    rows = queue.resolve_queue({}, {})["rows"]
    assert [r["callId"] for r in rows] == [out["id"]]


def test_dial_call_mirrors_customer_name():
    dynamo.put_item({"PK": dynamo.pk_cust("cust1"), "SK": "META",
                     "customerId": "cust1", "name": "박서준"})
    out = calls.resolve_dial_call({}, {"customerId": "cust1"})
    assert _queue_index_row(out["id"])["customer_name"] == "박서준"
    assert queue.resolve_queue({}, {})["rows"][0]["customerName"] == "박서준"


def test_dial_call_derives_subtitle_from_customer():
    """createCall이 Customer persona.age + credit_score로 subtitle("41세·KCB744") 파생."""
    dynamo.put_item({"PK": dynamo.pk_cust("cust1"), "SK": "META",
                     "customerId": "cust1", "name": "박서준",
                     "credit_score": 744, "persona": {"age": 41}})
    out = calls.resolve_dial_call({}, {"customerId": "cust1"})
    assert _queue_index_row(out["id"])["subtitle"] == "41세·KCB744"
    assert queue.resolve_queue({}, {})["rows"][0]["subtitle"] == "41세·KCB744"


def test_subtitle_preserved_across_state_change():
    """상태변경(transfer/end)으로 큐 인덱스가 갱신돼도 subtitle이 보존된다(null로 안 날아감).

    회귀 방지: _upsert_queue_index의 put_item 전체 덮어쓰기로 subtitle이 사라져
    큐 부가정보가 null이 되던 버그.
    """
    dynamo.put_item({"PK": dynamo.pk_cust("cust1"), "SK": "META",
                     "customerId": "cust1", "name": "박서준",
                     "credit_score": 744, "persona": {"age": 41}})
    cid = calls.resolve_dial_call({}, {"customerId": "cust1"})["id"]
    assert _queue_index_row(cid)["subtitle"] == "41세·KCB744"
    # 상태 변경 후에도 subtitle 유지
    calls.resolve_transfer_to_agent({}, {"callId": cid})
    assert _queue_index_row(cid)["subtitle"] == "41세·KCB744"
    row = next(r for r in queue.resolve_queue({}, {})["rows"] if r["callId"] == cid)
    assert row["subtitle"] == "41세·KCB744"


def test_subtitle_partial_when_age_missing():
    """age 없고 credit_score만 있으면 'KCB744'만 — 데이터 가능한 부분만 구성."""
    dynamo.put_item({"PK": dynamo.pk_cust("cust1"), "SK": "META",
                     "customerId": "cust1", "name": "박서준", "credit_score": 744})
    out = calls.resolve_dial_call({}, {"customerId": "cust1"})
    assert _queue_index_row(out["id"])["subtitle"] == "KCB744"


def test_transfer_updates_queue_index_state():
    cid = _make_call()
    calls.resolve_transfer_to_agent({}, {"callId": cid})
    assert _queue_index_row(cid)["state"] == "TRANSFER_PENDING"
    row = next(r for r in queue.resolve_queue({}, {})["rows"] if r["callId"] == cid)
    assert row["highlight"] == "needs_agent"


def test_end_call_updates_queue_index_state():
    cid = _make_call()
    calls.resolve_end_call({}, {"callId": cid})
    assert _queue_index_row(cid)["state"] == "ENDED"
