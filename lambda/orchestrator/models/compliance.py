"""ComplianceReview 엔터티 모델 (DATA-005 / #5).

컴플라이언스 작성→리뷰→재작성 로그 저장 (Bedrock Guardrails 검수 사이클 기록).
DynamoDB 싱글 테이블 `CALL#{id}` / `CMPL#{turn}#{try}`.

SSOT-3 카드③(`#card-strat`) 3단계 흐름: 가안(`#cmpDraft`) → 규제 검토(`#cmpChecks`,
다수 정책 check) → 최종 발화(`#cmpFinal`, 빨강 diff). 기존 이진 `action(approved|rewritten)`
구조를 `state` 5단계 상태머신으로 대체한다.

키는 AGENT `agent/state.py:ComplianceStep`(state/draft/violated_policies/final_text)과
정합한다. wire `onComplianceState` 구독의 상태값과도 동일(소문자).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

from ..api import dynamo


class ComplianceState(str, Enum):
    """검수 사이클 상태머신 (onComplianceState 구독)."""

    DRAFTING = "drafting"
    REVIEWING = "reviewing"
    REDACTING = "redacting"
    REDRAFTING = "redrafting"
    APPROVED = "approved"


# 정상 진행 순서 (전이 검증용). 같은 단계 머무름/뒤로 가기는 비정상.
_STATE_ORDER = [
    ComplianceState.DRAFTING,
    ComplianceState.REVIEWING,
    ComplianceState.REDACTING,
    ComplianceState.REDRAFTING,
    ComplianceState.APPROVED,
]


def can_transition(from_state: ComplianceState | str,
                   to_state: ComplianceState | str) -> bool:
    """순방향(인덱스 증가) 전이만 허용. 알 수 없는 상태면 False."""
    try:
        f = ComplianceState(from_state)
        t = ComplianceState(to_state)
    except ValueError:
        return False
    return _STATE_ORDER.index(t) > _STATE_ORDER.index(f)


def sk(turn: int, try_index: int) -> str:
    """SK 빌더 CMPL#{turn}#{try} (api/dynamo.sk_cmpl 위임)."""
    return dynamo.sk_cmpl(turn, try_index)


@dataclass
class ComplianceReview:
    """컴플라이언스 검수 로그 1건. PK=CALL#{id}, SK=CMPL#{turn}#{try}."""

    call_id: str
    turn: int
    try_index: int
    state: ComplianceState = ComplianceState.DRAFTING
    draft: str = ""                                  # 가안 발화 (#cmpDraft)
    violated_policies: list[str] = field(default_factory=list)  # 위반 정책 (#cmpChecks)
    final: str = ""                                  # 최종 발화 (#cmpFinal, diff)
    ts: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.call_id:
            raise ValueError("ComplianceReview.call_id is required")
        self.state = ComplianceState(self.state)
        self.violated_policies = list(self.violated_policies or [])

    def to_item(self) -> dict[str, Any]:
        return {
            "PK": dynamo.pk_call(self.call_id),
            "SK": sk(self.turn, self.try_index),
            "turn": self.turn,
            "try_index": self.try_index,
            "state": self.state.value,
            "draft": self.draft,
            "violated_policies": list(self.violated_policies),
            "final": self.final,
            "ts": self.ts,
        }

    @classmethod
    def from_item(cls, item: dict[str, Any]) -> "ComplianceReview":
        return cls(
            call_id=str(item["PK"]).removeprefix("CALL#"),
            turn=int(item["turn"]),
            try_index=int(item["try_index"]),
            state=item.get("state", ComplianceState.DRAFTING.value),
            draft=item.get("draft", ""),
            violated_policies=list(item.get("violated_policies") or []),
            final=item.get("final", ""),
            ts=item.get("ts"),
        )
