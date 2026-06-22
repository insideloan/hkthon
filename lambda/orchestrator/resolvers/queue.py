"""queue 쿼리 resolver (BACKEND #22).

관리자 대시보드 초기 로드/재연결용 큐 스냅샷.
QueueResult { summary{...}, rows[QueueRow] }. highlight=needs_agent|fraud_suspected.

활성 콜 목록은 싱글 테이블에서 콜 META 아이템을 모아 구성한다. 데모 규모라
전체 스캔 대신 큐 인덱스(PK=QUEUE, SK=CALL#{id})를 dialCall/상태변경이 갱신하는
방식을 쓰되, 여기서는 인덱스 아이템을 조회한다.
"""

from __future__ import annotations

import time

from ..api import dynamo

_QUEUE_PK = "QUEUE"


def _elapsed_sec(started_at: str | None) -> int:
    if not started_at:
        return 0
    try:
        t = time.strptime(started_at, "%Y-%m-%dT%H:%M:%SZ")
        return max(0, int(time.time() - time.mktime(t) + time.timezone))
    except (ValueError, TypeError):
        return 0


def _highlight(item: dict) -> str | None:
    if item.get("fraud_suspected"):
        return "fraud_suspected"
    if item.get("state") == "TRANSFER_PENDING" or item.get("needs_agent"):
        return "needs_agent"
    return None


def _row_out(item: dict) -> dict:
    return {
        "callId": item.get("callId"),
        "customerName": item.get("customer_name"),
        "state": item.get("state"),
        "stage": item.get("stage"),
        "churnRisk": item.get("churn_risk"),
        "assignee": item.get("assignee"),
        "channel": item.get("channel"),
        "elapsedSec": _elapsed_sec(item.get("started_at")),
        "highlight": _highlight(item),
    }


def resolve_queue(event: dict, args: dict) -> dict:
    """큐 스냅샷. highlightOnly=true면 highlight 행만 반환."""
    highlight_only = bool(args.get("highlightOnly", False))
    items = dynamo.query(_QUEUE_PK, "CALL#")
    rows = [_row_out(i) for i in items]

    if highlight_only:
        rows = [r for r in rows if r["highlight"] is not None]

    summary = {
        "total": len(rows),
        "needsAgent": sum(1 for r in rows if r["highlight"] == "needs_agent"),
        "fraudSuspected": sum(1 for r in rows if r["highlight"] == "fraud_suspected"),
        "inCall": sum(1 for r in rows if r["state"] == "IN_CALL"),
    }
    return {"summary": summary, "rows": rows}
