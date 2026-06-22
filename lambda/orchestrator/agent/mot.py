"""MOT(Moment of Truth) 탐지 / MOT detection.

AGENT 모듈. SSOT: docs/consult_redesigned-3.html.
BACKEND #28 계약 기준 이벤트 shape 산출.

위험 임계 (유지):
  - Δchurn ≥ +12  또는  churn_after ≥ 60 → 위험 MOT
  - 이탈성 이용가능성 신호(signals.Usability._RISK_USABILITY) → 위험 MOT

전환 트리거 (유지):
  - intent ∈ {TRANSFER_INTENT, BUYING_INTENT} → 전환 MOT
  - 진행성 이용가능성 신호(signals.Usability._CONVERSION_USABILITY) → 전환 MOT

마커 매핑 (SSOT-3 신규):
  rz-rate     → MOT_1  stageIndex=0  (TRUST:     대출 거부·경계)
  rz-compare  → MOT_2  stageIndex=0  (TRUST:     불신·조건 의심)
  rz-pay      → MOT_3  stageIndex=1  (OBJECTION: 가격 저항)
  rz-security → MOT_4  stageIndex=2  (COLLATERAL:담보 오해)
  rz-avoid    → MOT_5  stageIndex=3  (CLOSE:     이탈 임박·전환 맺기)

state 전이: SHOW → ALERT → BLOCKED
  SHOW    : 위험 감지 (Δchurn≥+12 또는 churn≥60)
  ALERT   : 위험 + 높은 churn (≥50) — 즉각 개입 필요
  BLOCKED : 전환 완료 (TRANSFER_INTENT/BUYING_INTENT) — 방어 완료

폐기됨 (SSOT-3): type:RISK|CONVERSION, narrative, strategy, outcome,
  churnBefore/churnAfter 자유 필드 → wire에서 제거.
"""

from __future__ import annotations

from typing import Optional

from .signals import Usability
from .state import CallState, Intent, MotResult

# ─────────────────────────────────────────────────────────────────────────────
# 상수
# ─────────────────────────────────────────────────────────────────────────────

_RISK_DELTA = 12
_RISK_ABS = 60
_ALERT_ABS = 50  # ALERT 상태 진입 churn 임계

_CONVERSION_INTENTS = {Intent.TRANSFER_INTENT, Intent.BUYING_INTENT}

# MOT 순서 매핑: (motId, stageIndex)
# stageIndex: 0=TRUST, 1=OBJECTION, 2=COLLATERAL, 3=CLOSE
# 탐지 순서 = 시나리오 여정 순서 (rz 번호 오름차순)
_MOT_SEQUENCE = [
    ("MOT_1", 0),  # rz-rate     신뢰 쌓기
    ("MOT_2", 0),  # rz-compare  신뢰 쌓기
    ("MOT_3", 1),  # rz-pay      우려 풀기
    ("MOT_4", 2),  # rz-security 담보 오해
    ("MOT_5", 3),  # rz-avoid    전환 맺기
]


# ─────────────────────────────────────────────────────────────────────────────
# 내부 헬퍼
# ─────────────────────────────────────────────────────────────────────────────


def _resolve_mot_id(turn_seq: int) -> tuple[str, int]:
    """turn_seq(0-based)로 여정 상의 MOT 마커 ID 및 stageIndex 결정.

    MOT_1~5는 시나리오 순서 기반으로 순환 할당.
    실제 프로덕션에서는 stage/context 기반 매핑으로 대체 가능.
    """
    idx = min(turn_seq, len(_MOT_SEQUENCE) - 1)
    return _MOT_SEQUENCE[idx]


def _resolve_state(
    is_conversion: bool,
    churn_after: int,
) -> str:
    """MOT wire state 결정.

    BLOCKED : 전환 완료 (TRANSFER_INTENT/BUYING_INTENT)
    ALERT   : 위험 + churn ≥ 50
    SHOW    : 위험 감지 (churn < 50)
    """
    if is_conversion:
        return "BLOCKED"
    if churn_after >= _ALERT_ABS:
        return "ALERT"
    return "SHOW"


# ─────────────────────────────────────────────────────────────────────────────
# 공개 API
# ─────────────────────────────────────────────────────────────────────────────

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
    """이번 턴의 MOT를 판정. 없으면 None.

    Returns MotResult with SSOT-3 계약 필드:
      motId, turn_seq, churn_before, churn_after,
      triggers, state, stageIndex, is_conversion
    """
    churn_before: int = state.get("churn_before", 50)
    churn_after: int = state.get("churn_after", churn_before)
    intent = state.get("intent")
    turn_seq: int = state.get("next_seq", 0)
    usability = state.get("usability")

    is_conversion = intent in _CONVERSION_INTENTS or usability in _CONVERSION_USABILITY
    is_risk = (
        (churn_after - churn_before >= _RISK_DELTA)
        or (churn_after >= _RISK_ABS)
        or (usability in _RISK_USABILITY)
    )

    # 전환 또는 위험이 없으면 MOT 없음
    if not is_conversion and not is_risk:
        return None

    mot_id, stage_index = _resolve_mot_id(turn_seq)
    mot_state = _resolve_state(is_conversion, churn_after)

    # 전환 시: 모든 churn_tokens; 위험 시: CONS 토큰만
    # Usability 신호가 있으면 triggers에 추가
    if is_conversion:
        triggers = [t["text"] for t in state.get("churn_tokens", [])]
        if usability in _CONVERSION_USABILITY:
            triggers.append(usability.value)
    else:
        triggers = [
            t["text"]
            for t in state.get("churn_tokens", [])
            if t.get("polarity") == "CONS"
        ]
        if usability in _RISK_USABILITY:
            triggers.append(usability.value)

    return MotResult(
        motId=mot_id,
        turn_seq=turn_seq,
        churn_before=churn_before,
        churn_after=churn_after,
        triggers=triggers,
        state=mot_state,
        stageIndex=stage_index,
        is_conversion=is_conversion,
    )
