"""AGENT-010 (#18) — 컴플라이언스 루프 + 룰 기반 Guardrails 검수 검증."""

from orchestrator.agent import compliance as c
from orchestrator.agent.state import Stage


def test_clean_text_passes():
    v = c._rule_guardrails("상담원에게 바로 연결해 드리겠습니다.")
    assert v["blocked"] is False
    assert v["violated"] == []


def test_confirm_promise_blocked():
    v = c._rule_guardrails("고객님은 무조건 승인되십니다")
    assert v["blocked"] is True
    assert "CONFIRM_PROMISE" in v["violated"]


def test_rate_never_rises_blocked():
    v = c._rule_guardrails("금리가 절대 안 오릅니다")
    assert v["blocked"] is True
    assert "RATE_NEVER_RISES" in v["violated"]


def test_risk_downplay_blocked():
    v = c._rule_guardrails("연체하셔도 그럴 일 없으니 걱정 안 하셔도 됩니다")
    assert v["blocked"] is True
    assert "RISK_DOWNPLAY" in v["violated"]


def test_fixed_figure_blocked_without_disclaimer():
    v = c._rule_guardrails("한도는 3000만원입니다")
    assert v["blocked"] is True
    assert "FIXED_FIGURE" in v["violated"]


def test_figure_with_disclaimer_passes():
    """예시/가정 + 심사 단서가 있으면 수치 면제 (공통요건 §2 충족)."""
    v = c._rule_guardrails("예시로 금리 12.9% 정도이며 심사 결과에 따라 달라질 수 있습니다")
    assert v["blocked"] is False


def test_review_loop_clean_draft_immediately_approved():
    log, final = c.review_loop("상담원에게 바로 연결해 드리겠습니다.", {"stage": Stage.CHANNEL})
    states = [s["state"] for s in log]
    assert states == ["drafting", "reviewing", "approved"]
    assert final == "상담원에게 바로 연결해 드리겠습니다."


def test_review_loop_emits_full_state_sequence_on_violation():
    """위반 draft → redacting/redrafting 거쳐 결국 approved(또는 fallback)로 종료."""
    log, final = c.review_loop("고객님 무조건 됩니다", {"stage": Stage.PROPOSE})
    states = [s["state"] for s in log]
    assert states[0] == "drafting"
    assert "redacting" in states
    assert "redrafting" in states
    assert states[-1] == "approved"
    assert final  # 비어있지 않음 (fallback 포함)
