"""Call 엔터티 모델 + CallState 전이 검증 (DATA-002 / #2).

통화 상태머신의 SSOT. 잘못된 전이를 막아 데모 안정성을 확보한다. DynamoDB
싱글 테이블 META 아이템(`CALL#{id}` / `META`)으로 저장된다.

주의: 여기의 `CallState`(통화 수명주기 8단계)는 AGENT의 `agent/state.py:CallStatus`
(ACTIVE/TRANSFER_PENDING/ENDED — LangGraph 그래프 내 라우팅용)와는 **별개**다. CallState는
프론트의 통화 진행 표시·전이 가드용 도메인 상태머신이다.

storage 키는 `resolvers/calls.py`(`state`/`scenario`/`started_at`/`ended_at` …)와 정합한다.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Optional

from ..api import dynamo


class CallState(str, Enum):
    """통화 수명주기 8단계."""

    DIALING = "DIALING"        # 발신 시도
    RINGING = "RINGING"        # 수신 대기(벨)
    IN_CALL = "IN_CALL"        # 통화 중(봇 상담)
    ON_HOLD = "ON_HOLD"        # 보류
    TRANSFERRING = "TRANSFERRING"  # 상담원 이관 중
    IN_AGENT = "IN_AGENT"      # 상담원 통화 중
    WRAP_UP = "WRAP_UP"        # 종료 후 마무리(요약 작성)
    ENDED = "ENDED"            # 종료(종단)


# 허용 전이 맵. 키→값 집합으로 한 단계 전이만 허용(되돌림/건너뜀 차단).
_ALLOWED_TRANSITIONS: dict[CallState, set[CallState]] = {
    CallState.DIALING: {CallState.RINGING, CallState.ENDED},
    CallState.RINGING: {CallState.IN_CALL, CallState.ENDED},
    CallState.IN_CALL: {CallState.ON_HOLD, CallState.TRANSFERRING,
                        CallState.WRAP_UP, CallState.ENDED},
    CallState.ON_HOLD: {CallState.IN_CALL, CallState.TRANSFERRING,
                        CallState.ENDED},
    CallState.TRANSFERRING: {CallState.IN_AGENT, CallState.ENDED},
    CallState.IN_AGENT: {CallState.WRAP_UP, CallState.ENDED},
    CallState.WRAP_UP: {CallState.ENDED},
    CallState.ENDED: set(),  # 종단 — 어떤 전이도 불허
}


def can_transition(from_state: CallState | str, to_state: CallState | str) -> bool:
    """from_state → to_state 전이가 허용되는지. 알 수 없는 상태면 False."""
    try:
        f = CallState(from_state)
        t = CallState(to_state)
    except ValueError:
        return False
    return t in _ALLOWED_TRANSITIONS.get(f, set())


@dataclass
class Call:
    """통화 도메인 모델. PK=CALL#{id}, SK=META."""

    id: str
    customer_id: Optional[str] = None
    state: CallState = CallState.DIALING
    scenario: str = "S1"  # 기본 시나리오 S1
    started_at: Optional[str] = None
    ended_at: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.id:
            raise ValueError("Call.id is required")
        # 문자열로 들어와도 enum으로 정규화(검증 포함).
        self.state = CallState(self.state)

    def transition_to(self, to_state: CallState | str) -> "Call":
        """전이 가드를 거쳐 상태 변경. 불법 전이면 ValueError."""
        target = CallState(to_state)
        if not can_transition(self.state, target):
            raise ValueError(
                f"illegal call state transition: {self.state.value} → {target.value}"
            )
        self.state = target
        return self

    def to_item(self) -> dict[str, Any]:
        return {
            "PK": dynamo.pk_call(self.id),
            "SK": dynamo.SK_META,
            "callId": self.id,
            "customerId": self.customer_id,
            "state": self.state.value,
            "scenario": self.scenario,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
        }

    @classmethod
    def from_item(cls, item: dict[str, Any]) -> "Call":
        return cls(
            id=item["callId"],
            customer_id=item.get("customerId"),
            state=item.get("state", CallState.DIALING.value),
            scenario=item.get("scenario", "S1"),
            started_at=item.get("started_at"),
            ended_at=item.get("ended_at"),
        )
