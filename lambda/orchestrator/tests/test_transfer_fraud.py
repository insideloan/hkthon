"""AGENT-006 (#14) — transfer/fraud 노드 검증.

- transfer_node: call_status → TRANSFER_PENDING (상담원 이관 = 성공경로)
- detect_fraud: fraud_suspected 플래그만 세팅, 라우팅·통화 종료에 영향 없음
"""

from orchestrator.agent import nodes
from orchestrator.agent.state import CallStatus, Intent, Route, Stage


# ─────────────────────────────────────────────────────────────────────────────
# transfer_node — 상태 전이
# ─────────────────────────────────────────────────────────────────────────────


def test_transfer_sets_transfer_pending():
    """transfer 시 call_status가 TRANSFER_PENDING으로 전이 (Acceptance #1)."""
    out = nodes.transfer_node({"history": []})
    assert out["call_status"] == CallStatus.TRANSFER_PENDING
    assert out["route"] == Route.TRANSFER
    assert out["bot_text"]  # 이관 멘트 존재


def test_transfer_is_not_ended():
    """이관은 종료(ENDED)가 아니다 — 성공경로."""
    out = nodes.transfer_node({"history": []})
    assert out["call_status"] != CallStatus.ENDED


# ─────────────────────────────────────────────────────────────────────────────
# transfer_node — 핸드오프 요약 (상담원 이관 맥락 전달)
# ─────────────────────────────────────────────────────────────────────────────


def test_transfer_handoff_summary_is_rule_based_no_llm(monkeypatch):
    """핸드오프 요약은 룰 기반(결정적)으로 즉시 생성 — 이관 임계 경로에서 LLM 호출 안 함.

    요약은 상담원 CRM 탭 표시용 사후 정보라, 라이브 이관 지연을 줄이려 LLM을 쓰지 않는다.
    (맥락은 단계/의도/이탈위험/직전 발화로 전달되며, 더 풍부한 요약은 통화 종료 후 보강.)
    """
    from orchestrator.llm import router

    def _boom(*a, **k):  # LLM이 호출되면 실패시켜 '호출 안 함'을 강제 검증
        raise AssertionError("handoff summary must not call the LLM on the transfer path")

    monkeypatch.setattr(router, "converse", _boom)
    out = nodes.transfer_node({
        "history": [{"seq": 1, "speaker": "customer", "text": "금리가 너무 높아요", "node": None}],
        "customer_text": "사람 바꿔주세요",
        "stage": Stage.PROPOSE,
        "intent": Intent.TRANSFER_INTENT,
        "churn_after": 55,
    })
    s = out["handoff_summary"]
    assert "상담원 연결 요청" in s
    assert "사람 바꿔주세요" in s  # 직전 발화 포함
    assert "55" in s              # 이탈위험 포함


def test_transfer_handoff_summary_fallback_when_no_context():
    """대화 맥락이 전혀 없어도 결정적 요약을 반환한다."""
    out = nodes.transfer_node({"history": []})
    assert out["handoff_summary"]
    assert "상담원 연결 요청" in out["handoff_summary"]


# ─────────────────────────────────────────────────────────────────────────────
# detect_fraud — 플래그만, 분기·종료 없음 (Acceptance #2)
# ─────────────────────────────────────────────────────────────────────────────


def _state(text, **kw):
    base = {"customer_text": text, "history": [], "route": Route.RESPOND, "stage": Stage.CONSENT}
    base.update(kw)
    return base


def test_fraud_keyword_sets_flag():
    """사기 의심 키워드 → fraud_suspected=True."""
    out = nodes.detect_fraud(_state("이거 진짜 현대캐피탈 맞아요? 보이스피싱 아니에요?"))
    assert out["fraud_suspected"] is True


def test_fraud_flag_does_not_change_route_or_stage():
    """fraud 플래그가 라우팅/단계를 바꾸지 않는다 — 통화 계속(Acceptance #2)."""
    out = nodes.detect_fraud(_state("보이스피싱 아니에요?", route=Route.RESPOND, stage=Stage.CONSENT))
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
