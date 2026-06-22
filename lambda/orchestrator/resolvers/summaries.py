"""callSummary 쿼리 + endCall 요약 write path (BACKEND #27).

CallSummaryResult: 고객 프로필 / 핵심 니즈 / 다음 액션 + mots[] (신규 형상).
CRM 화면(#view-summary)에는 독립 MotBoard 없음 — MOT는 sum-flow 4단계 li에
stage 기준으로 매핑되어 표시된다.
"""

from __future__ import annotations

from ..api import dynamo
from ..handler import OrchestratorError
from ._common import now_iso
from .mots import mot_out


def _summary_out(item: dict, mots: list[dict]) -> dict:
    return {
        "id": item.get("summaryId") or item.get("callId"),
        "callId": item.get("callId"),
        "resultType": item.get("result_type"),
        "content": item.get("content"),
        "flow": item.get("flow") or [],
        "categories": item.get("categories") or [],
        "handoffReason": item.get("handoff_reason"),
        "fraudSuspected": bool(item.get("fraud_suspected", False)),
        "strategyHeadline": item.get("strategy_headline"),
        "strategyLead": item.get("strategy_lead"),
        "createdAt": item.get("created_at"),
        "mots": mots,
    }


def resolve_call_summary(event: dict, args: dict) -> dict:
    """CRM 초기 로드용 요약. 없으면 NOT_FOUND."""
    call_id = args["id"]
    item = dynamo.get_item(dynamo.pk_call(call_id), dynamo.SK_SUMMARY)
    if not item:
        raise OrchestratorError("NOT_FOUND", f"summary not found: {call_id}")
    mot_items = dynamo.query(dynamo.pk_call(call_id), dynamo.SK_PREFIX_MOT)
    mots = [mot_out(m) for m in mot_items]
    mots.sort(key=lambda m: (m.get("turnSeq") is None, m.get("turnSeq")))
    return _summary_out(item, mots)


def write_summary(call_id: str) -> dict:
    """endCall 시 요약 아이템 생성. turn/MOT 집계 후 CALL#{id}/SUMMARY 기록.

    MOT는 신규 형상(markerId/state/stage/turnSeq)으로 이미 저장돼 있으므로
    별도 변환 없이 집계만 한다. content/strategy는 AGENT 분석 스냅샷(META)을 참조.
    """
    call = dynamo.get_item(dynamo.pk_call(call_id), dynamo.SK_META) or {}
    turns = dynamo.query(dynamo.pk_call(call_id), dynamo.SK_PREFIX_TURN)
    flow = [t.get("node") for t in turns if t.get("node")]

    item = {
        "PK": dynamo.pk_call(call_id),
        "SK": dynamo.SK_SUMMARY,
        "summaryId": call_id,
        "callId": call_id,
        "result_type": call.get("result_type"),
        "content": call.get("summary_content"),
        "flow": flow,
        "categories": call.get("categories") or [],
        "handoff_reason": call.get("handoff_reason"),
        "fraud_suspected": bool(call.get("fraud_suspected", False)),
        "strategy_headline": call.get("strategy_headline"),
        "strategy_lead": call.get("rationale"),
        "created_at": now_iso(),
    }
    dynamo.put_item(item)
    return item
