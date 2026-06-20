"""AGENT-005/006 (#13/#14) — fast_route 룰 분기 + transfer/close/silence 노드 검증.

하이브리드 1단계: 명확한 케이스는 LLM 없이 라우팅, 애매하면 NEEDS_LLM.
"""

from orchestrator.agent import nodes
from orchestrator.agent.state import Intent, Route, Stage


def _route(text):
    return nodes.fast_route({"customer_text": text})


def test_rejection_routes_to_close():
    out = _route("관심없어요 끊을게요")
    assert out["intent"] == Intent.REJECTION
    assert out["route"] == Route.CLOSE
    assert out["classified_by"] == "rule"


def test_agent_request_routes_to_transfer():
    out = _route("상담원 바꿔주세요")
    assert out["intent"] == Intent.TRANSFER_INTENT
    assert out["route"] == Route.TRANSFER


def test_limit_inquiry_routes_to_transfer():
    out = _route("한도조회 해주세요")
    assert out["intent"] == Intent.LIMIT_INQUIRY
    assert out["route"] == Route.TRANSFER


def test_opt_out_routes_to_close():
    out = _route("연락하지마세요")
    assert out["intent"] == Intent.OPT_OUT
    assert out["route"] == Route.CLOSE


def test_silence_routes_to_silence():
    assert _route("")["route"] == Route.SILENCE
    assert _route("네")["route"] == Route.SILENCE


def test_ambiguous_defers_to_llm():
    out = _route("그게 무슨 대출인데요?")
    assert out["route"] == Route.NEEDS_LLM
    assert out["intent"] == Intent.UNCLEAR


def test_fast_route_branch_mapping():
    assert nodes.fast_route_branch({"route": Route.NEEDS_LLM}) == "classify"
    assert nodes.fast_route_branch({"route": Route.SILENCE}) == "silence"
    assert nodes.fast_route_branch({"route": Route.CLOSE}) == "churn_score"


def test_route_intent_mapping():
    assert nodes.route_intent({"route": Route.TRANSFER}) == "transfer_node"
    assert nodes.route_intent({"route": Route.CLOSE}) == "close_node"
    assert nodes.route_intent({"route": Route.SILENCE}) == "silence"
    assert nodes.route_intent({"route": Route.RESPOND}) == "respond"


def test_transfer_node_sets_transfer_route():
    out = nodes.transfer_node({"history": []})
    assert out["route"] == Route.TRANSFER
    assert out["bot_text"]


def test_close_node_opt_out_message():
    out = nodes.close_node({"intent": Intent.OPT_OUT})
    assert "철회" in out["bot_text"]
    assert out["stage"] == Stage.CLOSING


def test_silence_node_terminates_after_repeated_silence():
    """연속 무응답 2회↑ → 종료 멘트 + CLOSING."""
    history = [
        {"seq": 1, "speaker": "customer", "text": "", "node": None},
        {"seq": 2, "speaker": "customer", "text": "음", "node": None},
    ]
    out = nodes.silence({"history": history})
    assert out["stage"] == Stage.CLOSING
