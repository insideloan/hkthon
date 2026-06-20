"""AGENT-003 (#11) — MOT 탐지 규칙 검증.

RISK: Δchurn≥+12 또는 churn≥60. CONVERSION: TRANSFER_INTENT/LIMIT_INQUIRY/BUYING_INTENT.
"""

from orchestrator.agent import mot
from orchestrator.agent.state import Intent


def _state(**kw):
    base = {"churn_before": 50, "churn_after": 50, "intent": Intent.QUESTION_TERMS,
            "next_seq": 3, "churn_tokens": [], "strategy": {}}
    base.update(kw)
    return base


def test_risk_by_delta():
    """Δchurn ≥ +12 → RISK."""
    m = mot.detect(_state(churn_before=50, churn_after=63))
    assert m is not None and m["type"] == "RISK"


def test_risk_by_absolute():
    """churn ≥ 60 → RISK."""
    m = mot.detect(_state(churn_before=58, churn_after=61))
    assert m is not None and m["type"] == "RISK"


def test_conversion_on_transfer_intent():
    """상담원 연결 의도 → CONVERSION."""
    m = mot.detect(_state(intent=Intent.TRANSFER_INTENT, churn_after=40))
    assert m is not None and m["type"] == "CONVERSION"
    assert m["outcome"] == "converted"


def test_conversion_on_limit_inquiry():
    """한도조회(성공경로) → CONVERSION."""
    m = mot.detect(_state(intent=Intent.LIMIT_INQUIRY, churn_after=40))
    assert m is not None and m["type"] == "CONVERSION"


def test_no_mot_on_calm_turn():
    """위험/전환 신호 없는 평온한 턴 → MOT 없음."""
    m = mot.detect(_state(churn_before=50, churn_after=52, intent=Intent.QUESTION_TERMS))
    assert m is None


def test_conversion_takes_priority_over_risk():
    """전환 의도가 있으면 churn이 높아도 CONVERSION 우선."""
    m = mot.detect(_state(intent=Intent.BUYING_INTENT, churn_before=50, churn_after=70))
    assert m is not None and m["type"] == "CONVERSION"
