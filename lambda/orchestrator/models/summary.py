"""Summary 엔터티 모델 (DATA-006 / #6).

종료 요약. PK `CALL#{id}` / SK `SUMMARY`. CRM 요약 뷰(`#view-summary`)는 독립 MOT
보드 없이 `.sum-flow` 4단계(신뢰 쌓기/우려 풀기/담보 오해/전환 맺기) 각 `li`에 MOT
마커를 인라인 표시한다 → `crm_stages` 필드로 단계별 마커 id 목록을 담는다.

storage 키는 `resolvers/summaries.py:_summary_out`(`result_type`/`strategy_headline`/
`strategy_lead`/`content` …)과 정합한다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

from ..api import dynamo


class ResultType(str, Enum):
    """통화 종료 결과 유형."""

    HANDOFF = "한도조회_상담원연결"   # (레거시) 수동 상담원 이관 — 자동 흐름 미사용
    AI_INTAKE = "AI_본심사"           # AI가 직접 본심사 접수·진행(상담원 연결 대체)
    APPROVED = "가입승인"
    REJECTED = "거절"


@dataclass
class Summary:
    """종료 요약. PK=CALL#{id}, SK=SUMMARY.

    crm_stages: list of {stage, text, mots:[marker id]} — sum-flow 4단계 + 단계별 MOT.
    """

    call_id: str
    result_type: Optional[ResultType] = None
    content: Optional[str] = None
    crm_stages: list[dict[str, Any]] = field(default_factory=list)
    strategy_headline: Optional[str] = None   # .stx
    strategy_lead: Optional[str] = None        # .slead (대표 발화방향)
    created_at: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.call_id:
            raise ValueError("Summary.call_id is required")
        if self.result_type is not None:
            self.result_type = ResultType(self.result_type)
        self.crm_stages = [self._normalize_stage(s) for s in (self.crm_stages or [])]

    @staticmethod
    def _normalize_stage(stage: dict[str, Any]) -> dict[str, Any]:
        return {
            "stage": stage.get("stage"),
            "text": stage.get("text", ""),
            "mots": list(stage.get("mots") or []),
        }

    def to_item(self) -> dict[str, Any]:
        return {
            "PK": dynamo.pk_call(self.call_id),
            "SK": dynamo.SK_SUMMARY,
            "callId": self.call_id,
            "result_type": self.result_type.value if self.result_type else None,
            "content": self.content,
            "crm_stages": [dict(s) for s in self.crm_stages],
            "strategy_headline": self.strategy_headline,
            "strategy_lead": self.strategy_lead,
            "created_at": self.created_at,
        }

    @classmethod
    def from_item(cls, item: dict[str, Any]) -> "Summary":
        return cls(
            call_id=item.get("callId") or str(item["PK"]).removeprefix("CALL#"),
            result_type=item.get("result_type"),
            content=item.get("content"),
            crm_stages=list(item.get("crm_stages") or []),
            strategy_headline=item.get("strategy_headline"),
            strategy_lead=item.get("strategy_lead"),
            created_at=item.get("created_at"),
        )
