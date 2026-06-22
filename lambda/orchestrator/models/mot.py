"""MOT 엔터티 모델 (DATA-004 / #4).

여정 맵 MOT 마커(rz-rate/compare/pay/security/avoid)와 CRM 요약 sum-flow 단계별
마커 표시를 위한 엔터티. DynamoDB 싱글 테이블 `CALL#{id}` / `MOT#{seq}`.

⚠️ 계약 정합 (BACKEND #28 canonical):
  모델은 SSOT-3 입력 도메인 값을 받아 **검증**하되, DynamoDB 저장(`to_item`)은
  기존 `resolvers/mots.py:mot_out`가 읽는 **wire-canonical 키**로 마샬링한다.
    - marker_id  rz-rate/compare/pay/security/avoid → wire markerId  MOT_1..MOT_5
    - state      show/alert/blocked                 → wire state     SHOW|ALERT|BLOCKED
    - crm_stage  신뢰 쌓기/우려 풀기/담보 오해/전환 맺기 → wire stage  TRUST|OBJECTION|COLLATERAL|CLOSE
  폐기 필드(type/churn_before/after/triggers/strategy/outcome/narrative)는 저장하지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from ..api import dynamo

# SSOT-3 도메인 값 → wire-canonical 매핑 (BACKEND #28)
_MARKER_TO_WIRE = {
    "rz-rate": "MOT_1",
    "rz-compare": "MOT_2",
    "rz-pay": "MOT_3",
    "rz-security": "MOT_4",
    "rz-avoid": "MOT_5",
}
_WIRE_TO_MARKER = {v: k for k, v in _MARKER_TO_WIRE.items()}

_STAGE_TO_WIRE = {
    "신뢰 쌓기": "TRUST",
    "우려 풀기": "OBJECTION",
    "담보 오해": "COLLATERAL",
    "전환 맺기": "CLOSE",
}
_WIRE_TO_STAGE = {v: k for k, v in _STAGE_TO_WIRE.items()}

_ALLOWED_MARKERS = set(_MARKER_TO_WIRE)
_ALLOWED_STATES = {"show", "alert", "blocked"}
_ALLOWED_CRM_STAGES = set(_STAGE_TO_WIRE)


@dataclass
class MOT:
    """Moment-of-Truth 마커. PK=CALL#{id}, SK=MOT#{seq:04d}.

    내부 도메인 표현은 SSOT-3 값(rz-*/소문자 state/한글 crm_stage). wire 직렬화는
    `to_item()`에서 canonical(MOT_n/대문자/영문 enum)으로 매핑.
    """

    call_id: str
    seq: int
    marker_id: str          # rz-rate / rz-compare / rz-pay / rz-security / rz-avoid
    state: str              # show / alert / blocked
    crm_stage: str          # 신뢰 쌓기 / 우려 풀기 / 담보 오해 / 전환 맺기
    turn_seq: Optional[int] = None
    ts: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.call_id:
            raise ValueError("MOT.call_id is required")
        if self.marker_id not in _ALLOWED_MARKERS:
            raise ValueError(f"invalid marker_id: {self.marker_id!r} (rz-*)")
        if self.state not in _ALLOWED_STATES:
            raise ValueError(f"invalid state: {self.state!r} (show|alert|blocked)")
        if self.crm_stage not in _ALLOWED_CRM_STAGES:
            raise ValueError(f"invalid crm_stage: {self.crm_stage!r}")

    @property
    def marker_label(self) -> str:
        """표시용 라벨 MOT_1..MOT_5 (= wire markerId)."""
        return _MARKER_TO_WIRE[self.marker_id]

    def to_item(self) -> dict[str, Any]:
        """wire-canonical 형상으로 마샬링 (mots resolver 호환)."""
        return {
            "PK": dynamo.pk_call(self.call_id),
            "SK": dynamo.sk_mot(self.seq),
            "markerId": _MARKER_TO_WIRE[self.marker_id],
            "state": self.state.upper(),
            "stage": _STAGE_TO_WIRE[self.crm_stage],
            "turn_seq": self.turn_seq,
            "ts": self.ts,
        }

    @classmethod
    def from_item(cls, item: dict[str, Any]) -> "MOT":
        """wire-canonical 아이템 → 도메인 모델(SSOT-3 값으로 역매핑)."""
        seq = item.get("seq")
        if seq is None:
            seq = int(str(item["SK"]).removeprefix(dynamo.SK_PREFIX_MOT))
        wire_marker = item.get("markerId") or item.get("motId")
        wire_stage = item.get("stage")
        turn_seq = item.get("turn_seq")
        return cls(
            call_id=str(item["PK"]).removeprefix("CALL#"),
            seq=int(seq),
            marker_id=_WIRE_TO_MARKER.get(wire_marker, wire_marker),
            state=str(item.get("state", "")).lower(),
            crm_stage=_WIRE_TO_STAGE.get(wire_stage, wire_stage),
            turn_seq=int(turn_seq) if turn_seq is not None else None,
            ts=item.get("ts"),
        )
