"""MOT(Moment of Truth) 탐지 / MOT detection.

AGENT 모듈. 설계: docs/agent/LANGGRAPH-DESIGN.md §4.8, ARCHITECTURE.md §2(3).

- RISK MOT:      churn 급등(+12) 또는 churn>=60, 또는 이탈성 이용가능성 신호
- CONVERSION MOT: 전환 intent, 또는 진행성 이용가능성 신호(signals.Usability)
"""

from __future__ import annotations

from typing import Optional

from .signals import Usability
from .state import CallState, Intent, MotResult

_RISK_DELTA = 12
_RISK_ABS = 60
_CONVERSION_INTENTS = {Intent.TRANSFER_INTENT, Intent.LIMIT_INQUIRY, Intent.BUYING_INTENT}

# 이용가능성(signals.Usability) 신호 → MOT 보강.
# 진행성 신호는 전환의 순간, 이탈성 신호는 위험의 순간을 의미한다.
_CONVERSION_USABILITY = {
    Usability.PROCEED_NOW,      # "지금 바로 해볼게요"
    Usability.CONDITIONAL,      # "금리 괜찮으면 진행할게요"
    Usability.BENEFIT_DRIVEN,   # "확실히 더 유리하면 해볼 수 있죠"
    Usability.URGENT_EXEC,      # "오늘 안 되면 의미 없어요"
    Usability.NEEDS_AGENT,      # 상담원 연결 = 성공경로(TRANSFER_PENDING)
}
_RISK_USABILITY = {
    Usability.LOAN_REFUSED,     # "대출은 안 할 거예요"
    Usability.PRODUCT_MISMATCH, # "그런 상품은 필요 없어요"
    Usability.COMPLIANCE_STOP,  # "무조건 승인되는 거죠?" — 컴플라이언스 리스크
}


def detect(state: CallState) -> Optional[MotResult]:
    """이번 턴의 MOT를 판정. 없으면 None."""
    churn_before = state.get("churn_before", 50)
    churn_after = state.get("churn_after", churn_before)
    intent = state.get("intent")
    usability = state.get("usability")

    is_conversion = intent in _CONVERSION_INTENTS or usability in _CONVERSION_USABILITY
    is_risk = (
        (churn_after - churn_before >= _RISK_DELTA)
        or (churn_after >= _RISK_ABS)
        or (usability in _RISK_USABILITY)
    )

    # CONVERSION 우선 (성공경로 신호)
    if is_conversion:
        triggers = [t["text"] for t in state.get("churn_tokens", [])]
        if usability in _CONVERSION_USABILITY:
            triggers.append(usability.value)
        strategy = state.get("strategy", {})
        return MotResult(
            type="CONVERSION",
            turn_seq=state.get("next_seq", 0),
            churn_before=churn_before,
            churn_after=churn_after,
            triggers=triggers,
            strategy=strategy,
            outcome="converted",
            narrative=_narrative("CONVERSION", churn_before, churn_after, triggers, strategy),
        )

    if is_risk:
        triggers = [t["text"] for t in state.get("churn_tokens", []) if t["polarity"] == "CONS"]
        if usability in _RISK_USABILITY:
            triggers.append(usability.value)
        strategy = state.get("strategy", {})
        return MotResult(
            type="RISK",
            turn_seq=state.get("next_seq", 0),
            churn_before=churn_before,
            churn_after=churn_after,
            triggers=triggers,
            strategy=strategy,
            outcome="defended",  # TODO: 후속 턴에서 defended/lost 확정
            narrative=_narrative("RISK", churn_before, churn_after, triggers, strategy),
        )

    return None


def _narrative(
    mot_type: str,
    churn_before: int,
    churn_after: int,
    triggers: list[str],
    strategy: dict,
) -> str:
    """관리자 화면용 MOT 서술 한 줄을 결정적으로 생성(LLM 비의존, 데모 안정성).

    구성: [트리거 신호] + [churn 변화] + [채택 전략]. churn "사전 점수 1차 진실" 철학에 맞춰
    LLM 없이 state의 신호값만으로 만든다.
    """
    delta = churn_after - churn_before
    trig = ", ".join(dict.fromkeys(triggers)) if triggers else "신호 키워드 없음"
    tactic = strategy.get("tactic") or "기본 응대"

    if mot_type == "CONVERSION":
        return (
            f"전환 순간: '{trig}' 신호 포착(이탈위험 {churn_before}→{churn_after}). "
            f"'{tactic}'(으)로 성공 경로 연결."
        )
    # RISK
    arrow = f"{churn_before}→{churn_after}"
    spike = f", +{delta} 급등" if delta >= _RISK_DELTA else (f", {churn_after} 고위험" if churn_after >= _RISK_ABS else "")
    return (
        f"위험 순간: '{trig}' 신호로 이탈위험 상승({arrow}{spike}). "
        f"'{tactic}'(으)로 방어 시도."
    )
