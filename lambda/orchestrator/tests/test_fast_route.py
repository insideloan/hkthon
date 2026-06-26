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


def test_greeting_routes_to_respond_without_llm():
    """첫인사/통화 응답('여보세요')은 classify(LLM) 없이 RESPOND로 정상 진행.

    회귀 방지: '여보세요'가 NEEDS_LLM으로 위임돼 간헐 오분류·NAME 가드레일 redraft
    루프(→'정확한 내용은 상담원이…' fallback)를 유발하던 버그를 막는다.
    """
    for utt in ("여보세요", "여보세요?", "네 여보세요", "누구세요?"):
        out = _route(utt)
        assert out["route"] == Route.RESPOND, utt
        assert out["classified_by"] == "rule", utt


def test_greeting_with_transfer_keyword_still_transfers():
    """'여보세요 상담원 바꿔주세요'는 인사보다 이관이 우선(거절·이관을 먼저 검사)."""
    out = _route("여보세요 상담원 바꿔주세요")
    assert out["route"] == Route.TRANSFER


def test_ambiguous_defers_to_llm():
    out = _route("그게 무슨 대출인데요?")
    assert out["route"] == Route.NEEDS_LLM
    assert out["intent"] == Intent.UNCLEAR


def test_fast_route_branch_mapping():
    assert nodes.fast_route_branch({"route": Route.NEEDS_LLM}) == "classify"
    assert nodes.fast_route_branch({"route": Route.SILENCE}) == "silence"
    assert nodes.fast_route_branch({"route": Route.CLOSE}) == "churn_score"


def test_route_intent_mapping():
    assert nodes.route_intent({"route": Route.TRANSFER}) == "intake_node"
    assert nodes.route_intent({"route": Route.CLOSE}) == "close_node"
    assert nodes.route_intent({"route": Route.SILENCE}) == "silence"
    assert nodes.route_intent({"route": Route.RESPOND}) == "respond"


def test_intake_node_sets_transfer_route():
    out = nodes.intake_node({"history": []})
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


# ─────────────────────────────────────────────────────────────────────────────
# 연락 근거 고지 — CONSENT 단계 폐기. 마케팅수신동의 근거는 IDENTIFY stage 지침 +
# 공통요건으로 LLM이 생성한다(별도 고정 멘트 주입 없음).
# ─────────────────────────────────────────────────────────────────────────────


def test_respond_uses_blind_draft_in_identify():
    """IDENTIFY 단계 응답은 LLM 경로(speculative blind draft 재사용) — 고정 멘트 주입 없음."""
    out = nodes.respond({
        "stage": Stage.IDENTIFY,
        "history": [{"seq": 1, "speaker": "customer", "text": "여보세요", "node": None}],
        "_blind_draft": "안녕하세요, 현대캐피탈 AI 상담원입니다.",  # LLM 경로 진입 확인용
    })
    assert out["bot_draft"] == "안녕하세요, 현대캐피탈 AI 상담원입니다."
