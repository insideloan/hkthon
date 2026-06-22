"""mots 쿼리 resolver (BACKEND #26) — SSOT-3 신규 MOT 형상.

MOT 페이로드 (BACKEND #28 canonical):
  { markerId: MotMarkerId!, state: MotState!, stage: MotStage!, turnSeq: Int! }
  MotMarkerId = MOT_1..MOT_5   (rz-rate/compare/pay/security/avoid = FRONTEND DOM 매핑)
  MotState    = SHOW|ALERT|BLOCKED
  MotStage    = TRUST|OBJECTION|COLLATERAL|CLOSE  (sum-flow 4단계)

폐기: type(RISK|CONVERSION), churnBefore/After, triggers, strategy, outcome, narrative.
"""

from __future__ import annotations

from ..api import dynamo

# AGENT MotResult.stageIndex(0..3) → wire MotStage enum.
_STAGE_BY_INDEX = ["TRUST", "OBJECTION", "COLLATERAL", "CLOSE"]


def mot_out(item: dict) -> dict:
    """DynamoDB MOT 아이템 → GraphQL MOT (신규 형상)."""
    stage = item.get("stage")
    if stage is None and item.get("stageIndex") is not None:
        idx = item["stageIndex"]
        stage = _STAGE_BY_INDEX[idx] if 0 <= idx < len(_STAGE_BY_INDEX) else None
    return {
        "markerId": item.get("markerId") or item.get("motId"),
        "state": item.get("state"),
        "stage": stage,
        "turnSeq": item.get("turn_seq"),
    }


def resolve_mots(event: dict, args: dict) -> list[dict]:
    """통화별 MOT 목록 (turnSeq 정렬)."""
    call_id = args["callId"]
    items = dynamo.query(dynamo.pk_call(call_id), dynamo.SK_PREFIX_MOT)
    out = [mot_out(i) for i in items]
    out.sort(key=lambda m: (m.get("turnSeq") is None, m.get("turnSeq")))
    return out
