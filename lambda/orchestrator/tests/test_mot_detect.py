"""AGENT-003 (#11) — MOT 탐지 규칙 검증.

RISK: Δchurn≥+12 또는 churn≥60. CONVERSION: TRANSFER_INTENT/LIMIT_INQUIRY/BUYING_INTENT.
"""

from orchestrator.agent import mot
from orchestrator.agent.signals import Usability
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


# ── 신호축(Usability) 보강 ──────────────────────────────────────────────────


def test_conversion_by_usability_signal():
    """진행성 이용가능성 신호 → intent가 평범해도 CONVERSION."""
    m = mot.detect(_state(intent=Intent.QUESTION_TERMS, usability=Usability.PROCEED_NOW, churn_after=45))
    assert m is not None and m["type"] == "CONVERSION"
    assert Usability.PROCEED_NOW.value in m["triggers"]


def test_needs_agent_usability_is_conversion():
    """상담원 연결 필요 신호도 성공경로(CONVERSION)."""
    m = mot.detect(_state(intent=Intent.QUESTION_TERMS, usability=Usability.NEEDS_AGENT, churn_after=45))
    assert m is not None and m["type"] == "CONVERSION"


def test_risk_by_usability_signal():
    """이탈성 이용가능성 신호 → churn이 낮아도 RISK."""
    m = mot.detect(_state(intent=Intent.QUESTION_TERMS, usability=Usability.LOAN_REFUSED, churn_after=45))
    assert m is not None and m["type"] == "RISK"
    assert Usability.LOAN_REFUSED.value in m["triggers"]


def test_compliance_stop_usability_is_risk():
    """컴플라이언스 중단 신호 → RISK."""
    m = mot.detect(_state(intent=Intent.QUESTION_TERMS, usability=Usability.COMPLIANCE_STOP, churn_after=45))
    assert m is not None and m["type"] == "RISK"


# ── narrative 서술 생성 (결정적, LLM 비의존) ──────────────────────────────────


def test_risk_narrative_includes_trigger_churn_and_tactic():
    m = mot.detect(_state(
        churn_before=50, churn_after=70,
        churn_tokens=[{"text": "부담", "polarity": "CONS", "reason": "비용"}],
        strategy={"tactic": "부담 완화 전략", "headline": "h"},
    ))
    n = m["narrative"]
    assert "위험 순간" in n
    assert "부담" in n            # 트리거
    assert "50→70" in n           # churn 변화
    assert "+20 급등" in n        # delta
    assert "부담 완화 전략" in n   # 전략


def test_conversion_narrative_mentions_success_path():
    m = mot.detect(_state(
        intent=Intent.QUESTION_TERMS, usability=Usability.PROCEED_NOW, churn_after=40,
        strategy={"tactic": "한도 탐색 전략"},
    ))
    n = m["narrative"]
    assert "전환 순간" in n
    assert Usability.PROCEED_NOW.value in n
    assert "한도 탐색 전략" in n


def test_narrative_handles_missing_strategy_and_triggers():
    """전략/트리거 없어도 서술이 깨지지 않는다."""
    m = mot.detect(_state(churn_before=50, churn_after=65, churn_tokens=[], strategy={}))
    n = m["narrative"]
    assert "신호 키워드 없음" in n
    assert "기본 응대" in n


def test_narrative_dedupes_triggers():
    """중복 트리거는 한 번만 표기."""
    m = mot.detect(_state(
        churn_before=50, churn_after=70,
        churn_tokens=[
            {"text": "부담", "polarity": "CONS", "reason": "x"},
            {"text": "부담", "polarity": "CONS", "reason": "y"},
        ],
    ))
    assert m["narrative"].count("부담") == 1
