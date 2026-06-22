"""ScenarioRun 엔터티 모델 (DATA-006 / #6).

시나리오 실행 이력. PK `CALL#{id}` / SK `SCENARIO#{runId}`. SSOT-3 변경 없음(유지).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from ..api import dynamo


def sk_scenario(run_id: str) -> str:
    return f"SCENARIO#{run_id}"


@dataclass
class ScenarioRun:
    """시나리오 실행 1건. PK=CALL#{id}, SK=SCENARIO#{runId}."""

    call_id: str
    run_id: str
    scenario: str = "S1"
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    outcome: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.call_id:
            raise ValueError("ScenarioRun.call_id is required")
        if not self.run_id:
            raise ValueError("ScenarioRun.run_id is required")

    def to_item(self) -> dict[str, Any]:
        return {
            "PK": dynamo.pk_call(self.call_id),
            "SK": sk_scenario(self.run_id),
            "runId": self.run_id,
            "scenario": self.scenario,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "outcome": self.outcome,
        }

    @classmethod
    def from_item(cls, item: dict[str, Any]) -> "ScenarioRun":
        return cls(
            call_id=str(item["PK"]).removeprefix("CALL#"),
            run_id=item.get("runId") or str(item["SK"]).removeprefix("SCENARIO#"),
            scenario=item.get("scenario", "S1"),
            started_at=item.get("started_at"),
            ended_at=item.get("ended_at"),
            outcome=item.get("outcome"),
        )
