"""라이브 파이프라인 글루 — load_context / persist / run_turn / nextTurn 검증.

한 턴의 전체 경로(LANGGRAPH-DESIGN §2.1)를 FakeTable 위에서 돌려, 그래프 persist가
Streams 팬아웃(stream_fanout)이 읽는 wire-canonical 형상으로 write하는지 확인한다.
langgraph 미설치 환경에서는 skip(라이브 전용 의존성).
"""

from __future__ import annotations

import pytest

pytest.importorskip("langgraph", reason="langgraph는 라이브 모드 전용 의존성")

from orchestrator.api import config, dynamo
from orchestrator.models.customer import Customer

from ._fake_dynamo import FakeTable


@pytest.fixture(autouse=True)
def _fake_table(monkeypatch):
    monkeypatch.setenv("ORCHESTRATOR_MODE", "live")
    config.get_settings.cache_clear()
    dynamo.set_table(FakeTable())
    yield
    dynamo.set_table(None)
    config.get_settings.cache_clear()


def _seed_call(call_id="c-live-1", customer_id="cust-001"):
    """META(Call) + Customer 한 명을 시드해 load_context가 컨텍스트를 재구성하게 한다."""
    dynamo.put_item({
        "PK": dynamo.pk_call(call_id), "SK": dynamo.SK_META,
        "callId": call_id, "customerId": customer_id, "state": "IN_CALL",
    })
    dynamo.put_item(Customer(id=customer_id, name="박서준", target_product="대환대출").to_item())
    return call_id


# ── load_context ─────────────────────────────────────────────────────────────


def test_load_context_rebuilds_from_dynamo():
    """기존 Turn 이력 → churn_before/next_seq/history 재구성."""
    from orchestrator.agent import context

    call_id = _seed_call()
    dynamo.put_item({
        "PK": dynamo.pk_call(call_id), "SK": dynamo.sk_turn(1),
        "seq": 1, "speaker": "customer", "text": "금리가 높아요", "churn_after": 62,
    })
    state = context.load_call_state(call_id, "그래도 좀 비싼데요")
    assert state["churn_before"] == 62
    assert state["next_seq"] == 2
    assert state["customer"].get("name") == "박서준"
    assert state["customer_text"] == "그래도 좀 비싼데요"
    assert len(state["history"]) == 1


# ── persist (그래프 실행 후 write 형상) ────────────────────────────────────────


def test_run_turn_persists_bot_turn_and_meta():
    """run_turn → 봇 Turn write(seq=2) + Call META 분석 스냅샷 갱신."""
    from orchestrator.agent.runner import run_turn

    call_id = _seed_call()
    # 고객 발화 1건(seq=1) 기록 후 그래프 실행 → 봇 Turn(seq=2).
    dynamo.put_item({
        "PK": dynamo.pk_call(call_id), "SK": dynamo.sk_turn(1),
        "seq": 1, "speaker": "customer", "text": "한도가 얼마예요?",
    })
    out = run_turn(call_id, "한도가 얼마예요?")
    assert out is not None
    assert out["speaker"] == "bot"
    assert out["seq"] == 2
    assert out["flag"] in {"RISK", "DEF", "NEUTRAL"}

    # 봇 Turn이 DynamoDB에 기록됐는지 (stream_fanout TURN# 경로의 소스).
    bot = dynamo.get_item(dynamo.pk_call(call_id), dynamo.sk_turn(2))
    assert bot is not None and bot["speaker"] == "bot"
    assert bot["text"]  # 비어있지 않은 응답(LLM fallback 포함)

    # Call META에 분석 스냅샷(current_node 등) 누적.
    meta = dynamo.get_item(dynamo.pk_call(call_id), dynamo.SK_META)
    assert meta.get("current_node") is not None


def test_run_turn_intake_stays_active_with_ai_result_type():
    """상담원 요청(룰 fast_route) → AI 본심사 전환. 통화 ACTIVE 유지, result_type=AI_본심사 기록.

    사람 상담원 연결 폐기: TRANSFER_PENDING으로 전이하지 않고 통화를 이어가며,
    종료 후 resultType 분류용으로 result_type만 META에 남긴다(handoff_reason 없음).
    """
    from orchestrator.agent.runner import run_turn

    call_id = _seed_call("c-live-tr")
    out = run_turn(call_id, "사람 바꿔주세요")
    assert out is not None
    meta = dynamo.get_item(dynamo.pk_call(call_id), dynamo.SK_META)
    assert meta.get("state") != "TRANSFER_PENDING"
    assert meta.get("result_type") == "AI_본심사"
    assert not meta.get("handoff_reason")


def test_persisted_mot_is_wire_canonical():
    """위험 MOT가 생기면 stream_fanout이 읽는 wire 형상(markerId/state/stage)으로 저장."""
    from orchestrator.agent.runner import run_turn
    from orchestrator.resolvers.mots import resolve_mots

    call_id = _seed_call("c-live-mot")
    # 직전 churn을 높게 깔아 위험 델타/절대값을 유발.
    dynamo.put_item({
        "PK": dynamo.pk_call(call_id), "SK": dynamo.sk_turn(1),
        "seq": 1, "speaker": "customer", "text": "관심 없어요", "churn_after": 80,
    })
    run_turn(call_id, "그냥 끊을게요")
    mots = resolve_mots({}, {"callId": call_id})
    # MOT가 잡혔다면 wire enum 형상이어야 한다(없을 수도 있으나, 잡히면 형상 검증).
    for m in mots:
        assert m["markerId"].startswith("MOT_")
        assert m["state"] in {"SHOW", "ALERT", "BLOCKED"}
        assert m["stage"] in {"TRUST", "OBJECTION", "COLLATERAL", "CLOSE"}


# ── persist → stream_fanout 통합 (프론트 구독까지의 전체 루프) ───────────────────


def test_persisted_items_fan_out_to_subscriptions(monkeypatch):
    """run_turn이 write한 봇 Turn/META를 Streams 팬아웃에 흘려 _emit*가 나오는지 확인.

    persist write 형상이 stream_fanout 계약(TURN#/META 키)과 정합함을 end-to-end로 증명.
    """
    from orchestrator.agent.runner import run_turn
    from orchestrator.api import stream_fanout as sf

    monkeypatch.setattr(sf, "_DISABLE_EMIT", True)
    monkeypatch.setattr(sf, "_appsync_emit", None)

    call_id = _seed_call("c-live-fan")
    dynamo.put_item({
        "PK": dynamo.pk_call(call_id), "SK": dynamo.sk_turn(1),
        "seq": 1, "speaker": "customer", "text": "사람 바꿔주세요",
    })
    run_turn(call_id, "사람 바꿔주세요")

    # persist가 기록한 봇 Turn(seq=2)을 Streams INSERT로 재생.
    bot = dynamo.get_item(dynamo.pk_call(call_id), dynamo.sk_turn(2))
    meta = dynamo.get_item(dynamo.pk_call(call_id), dynamo.SK_META)
    rec_turn = {"eventName": "INSERT", "dynamodb": {"NewImage": bot}}
    rec_meta = {"eventName": "MODIFY", "dynamodb": {"NewImage": meta}}
    out = sf.handler({"Records": [rec_turn, rec_meta]})
    names = [e["mutation"] for e in out["emits"]]

    assert "_emitTurn" in names               # 봇 발화 → onTurn
    assert "_emitQueueUpdate" in names         # META 상태변경 → onQueueUpdate
    # AI 본심사 전환 → 통화 ACTIVE 유지, result_type=AI_본심사가 META에 기록됨.
    assert meta.get("state") != "TRANSFER_PENDING"
    assert meta.get("result_type") == "AI_본심사"


# ── nextTurn resolver ──────────────────────────────────────────────────────────


def test_next_turn_uses_last_customer_text():
    """customerText 미전달 시 마지막 customer Turn 텍스트로 그래프 실행."""
    from orchestrator.resolvers.turns import resolve_next_turn

    call_id = _seed_call("c-live-nt")
    dynamo.put_item({
        "PK": dynamo.pk_call(call_id), "SK": dynamo.sk_turn(1),
        "seq": 1, "speaker": "customer", "text": "금리가 부담돼요",
    })
    out = resolve_next_turn({}, {"callId": call_id})
    assert out is not None and out["speaker"] == "bot"


def test_next_turn_no_op_without_utterance():
    """customer 발화가 전혀 없으면 no-op(None)."""
    from orchestrator.resolvers.turns import resolve_next_turn

    call_id = _seed_call("c-live-empty")
    assert resolve_next_turn({}, {"callId": call_id}) is None


def test_next_turn_not_found():
    """없는 콜 → NOT_FOUND. (클래스 identity가 아니라 error_type으로 검증 —
    test_handler의 importlib.reload가 OrchestratorError를 재정의해도 견디게.)"""
    from orchestrator.resolvers.turns import resolve_next_turn

    with pytest.raises(Exception) as ei:
        resolve_next_turn({}, {"callId": "nope"})
    assert getattr(ei.value, "error_type", None) == "NOT_FOUND"


def test_next_turn_script_mode_no_op(monkeypatch):
    """스크립트 모드는 그래프를 타지 않는다(no-op)."""
    from orchestrator.resolvers.turns import resolve_next_turn

    monkeypatch.setenv("ORCHESTRATOR_MODE", "script")
    config.get_settings.cache_clear()
    call_id = _seed_call("c-live-script")
    dynamo.put_item({
        "PK": dynamo.pk_call(call_id), "SK": dynamo.sk_turn(1),
        "seq": 1, "speaker": "customer", "text": "안녕하세요",
    })
    assert resolve_next_turn({}, {"callId": call_id}) is None
