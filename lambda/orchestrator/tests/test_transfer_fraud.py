"""AGENT — intake/fraud 노드 검증.

- intake_node: AI 본심사 접수(사람 상담원 연결 폐기). call_status는 ACTIVE 유지,
  result_type="AI_본심사" 기록, 전략은 AI 접수 전환.
- detect_fraud: fraud_suspected 플래그만 세팅, 라우팅·통화 종료에 영향 없음
"""

from orchestrator.agent import nodes, signals
from orchestrator.agent.state import CallStatus, Intent, Route, Stage


# ─────────────────────────────────────────────────────────────────────────────
# intake_node — AI 본심사 전환 (상담원 연결 대체)
# ─────────────────────────────────────────────────────────────────────────────


def test_intake_stays_active():
    """AI 본심사는 통화 계속 — call_status ACTIVE 유지(TRANSFER_PENDING 아님)."""
    out = nodes.intake_node({"history": []})
    assert out["call_status"] == CallStatus.ACTIVE
    assert out["route"] == Route.TRANSFER  # 라우팅 경로명은 재사용
    assert out["bot_text"]  # 본심사 안내 멘트 존재


def test_intake_is_not_ended():
    """본심사 접수는 종료(ENDED)가 아니다 — 성공경로."""
    out = nodes.intake_node({"history": []})
    assert out["call_status"] != CallStatus.ENDED


def test_intake_records_ai_result_type():
    """종료 후 resultType 분류용으로 result_type=AI_본심사를 남긴다."""
    out = nodes.intake_node({"history": []})
    assert out["result_type"] == "AI_본심사"
    # 사람 이관 폐기 — 핸드오프 요약을 만들지 않는다.
    assert "handoff_summary" not in out


def test_intake_strategy_is_ai_intake_pivot():
    """전략은 AI 접수 전환 전략."""
    out = nodes.intake_node({"history": [], "intent": Intent.TRANSFER_INTENT})
    assert out["strategy"]["tactic"] == signals.Tactic.AI_INTAKE_PIVOT.value


def test_intake_bot_text_mentions_ai_screening():
    """안내 멘트에 AI 본심사 진행이 드러난다(사람 상담원 연결 멘트 아님)."""
    out = nodes.intake_node({"history": [], "intent": Intent.TRANSFER_INTENT})
    assert "본심사" in out["bot_text"]
    assert "상담원에게 연결" not in out["bot_text"]


def test_intake_limit_inquiry_mentions_limit():
    """한도조회 의도면 한도 확인 맥락의 멘트를 쓴다."""
    out = nodes.intake_node({"history": [], "intent": Intent.LIMIT_INQUIRY})
    assert "한도" in out["bot_text"]


# ─────────────────────────────────────────────────────────────────────────────
# detect_fraud — 플래그만, 분기·종료 없음 (Acceptance #2)
# ─────────────────────────────────────────────────────────────────────────────


def _state(text, **kw):
    base = {"customer_text": text, "history": [], "route": Route.RESPOND, "stage": Stage.IDENTIFY}
    base.update(kw)
    return base


def test_fraud_keyword_sets_flag():
    """사기 의심 키워드 → fraud_suspected=True."""
    out = nodes.detect_fraud(_state("이거 진짜 현대캐피탈 맞아요? 보이스피싱 아니에요?"))
    assert out["fraud_suspected"] is True


def test_fraud_flag_does_not_change_route_or_stage():
    """fraud 플래그가 라우팅/단계를 바꾸지 않는다 — 통화 계속(Acceptance #2)."""
    out = nodes.detect_fraud(_state("보이스피싱 아니에요?", route=Route.RESPOND, stage=Stage.IDENTIFY))
    # detect_fraud는 fraud_suspected만 반환 — route/stage/call_status 키를 건드리지 않음
    assert "route" not in out
    assert "stage" not in out
    assert "call_status" not in out


def test_no_fraud_keyword_keeps_false():
    """사기 신호 없으면 False 유지."""
    out = nodes.detect_fraud(_state("금리가 어떻게 되나요?"))
    assert out["fraud_suspected"] is False


def test_fraud_latches_from_prior_llm_flag():
    """classify(LLM)가 이미 세팅한 fraud_suspected는 키워드 없어도 유지(latching)."""
    out = nodes.detect_fraud(_state("그냥 좀 의심스러워서요", fraud_suspected=True))
    assert out["fraud_suspected"] is True


def test_fraud_rule_or_llm_combination():
    """룰 OR LLM — 룰만 맞아도 True."""
    out = nodes.detect_fraud(_state("번호 어떻게 아셨어요?", fraud_suspected=False))
    assert out["fraud_suspected"] is True


# ─────────────────────────────────────────────────────────────────────────────
# 종단 노드 ENDED 전이 (transfer와 대비)
# ─────────────────────────────────────────────────────────────────────────────


def test_close_node_sets_ended():
    out = nodes.close_node({"intent": Intent.REJECTION})
    assert out["call_status"] == CallStatus.ENDED
    assert out["stage"] == Stage.CLOSING


def test_silence_terminates_with_ended_after_repeated():
    history = [
        {"seq": 1, "speaker": "customer", "text": "", "node": None},
        {"seq": 2, "speaker": "customer", "text": "음", "node": None},
    ]
    out = nodes.silence({"history": history})
    assert out["call_status"] == CallStatus.ENDED


def test_silence_first_time_does_not_end():
    """첫 무응답은 재확인 — 종료 아님(call_status 미설정 = ACTIVE 유지)."""
    out = nodes.silence({"history": []})
    assert "call_status" not in out
