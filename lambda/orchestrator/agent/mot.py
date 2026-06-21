"""MOT(Moment of Truth) 탐지 / MOT detection.

AGENT 모듈. 설계: docs/agent/LANGGRAPH-DESIGN.md §4.8, ARCHITECTURE.md §2(3).

- RISK MOT:      churn_after - churn_before >= +12  또는  churn_after >= 60
- CONVERSION MOT: intent ∈ {TRANSFER_INTENT, LIMIT_INQUIRY, BUYING_INTENT}
"""

from __future__ import annotations

from typing import Optional

from .state import CallState, Intent, MotResult

_RISK_DELTA = 12
_RISK_ABS = 60
_CONVERSION_INTENTS = {Intent.TRANSFER_INTENT, Intent.LIMIT_INQUIRY, Intent.BUYING_INTENT}


def detect(state: CallState) -> Optional[MotResult]:
    """이번 턴의 MOT를 판정. 없으면 None."""
    churn_before = state.get("churn_before", 50)
    churn_after = state.get("churn_after", churn_before)
    intent = state.get("intent")

    is_conversion = intent in _CONVERSION_INTENTS
    is_risk = (churn_after - churn_before >= _RISK_DELTA) or (churn_after >= _RISK_ABS)

    # CONVERSION 우선 (성공경로 신호)
    if is_conversion:
        return MotResult(
            type="CONVERSION",
            turn_seq=state.get("next_seq", 0),
            churn_before=churn_before,
            churn_after=churn_after,
            triggers=[t["text"] for t in state.get("churn_tokens", [])],
            strategy=state.get("strategy", {}),
            outcome="converted",
            narrative="",  # TODO: LLM 또는 템플릿 기반 서술 생성
        )

    if is_risk:
        return MotResult(
            type="RISK",
            turn_seq=state.get("next_seq", 0),
            churn_before=churn_before,
            churn_after=churn_after,
            triggers=[t["text"] for t in state.get("churn_tokens", []) if t["polarity"] == "CONS"],
            strategy=state.get("strategy", {}),
            outcome="defended",  # TODO: 후속 턴에서 defended/lost 확정
            narrative="",
        )

    return None
