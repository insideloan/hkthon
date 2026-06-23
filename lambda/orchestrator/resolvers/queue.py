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
from ..handler import OrchestratorError

_QUEUE_PK = dynamo.PK_QUEUE

# 시연 시나리오의 시작점(박서준)이라 큐에서 사라지면 데모 흐름이 깨진다.
# 프론트는 휴지통 버튼을 숨기지만, 직접 API 호출 우회까지 막도록 여기서도 거부한다.
PROTECTED_CALL_IDS = frozenset({"c-demo-01"})


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
    # started_at(snake, 큐 인덱스) / startedAt(camel, CALL#/META) 양쪽 허용 —
    # fallback 스캔 경로가 META 아이템을 그대로 넘기기 때문.
    started = item.get("started_at") or item.get("startedAt")
    return {
        "callId": item.get("callId"),
        "customerName": item.get("customer_name"),
        "state": item.get("state"),
        "stage": item.get("stage"),
        "churnRisk": item.get("churn_risk"),
        "assignee": item.get("assignee"),
        "channel": item.get("channel"),
        "elapsedSec": _elapsed_sec(started),
        "highlight": _highlight(item),
    }


def _snapshot_items() -> list[dict]:
    """큐 row 소스 아이템. 인덱스(PK=QUEUE) 우선, 비었으면 CALL#/META 스캔.

    정상 경로는 dialCall/상태변경이 갱신하는 큐 인덱스. 인덱스가 비어 있으면
    (인덱스 도입 전 생성된 콜, 또는 booth 콜드스타트) META를 스캔해 활성 콜을
    복원한다 — 데모 규모 전용 fallback. CREATED는 발신 전이라 큐에서 제외.
    """
    items = dynamo.query(_QUEUE_PK, dynamo.SK_PREFIX_CALL)
    if items:
        return items
    metas = dynamo.scan(sk=dynamo.SK_META)
    return [
        m for m in metas
        if str(m.get("PK", "")).startswith(dynamo.SK_PREFIX_CALL)
        and m.get("state") and m.get("state") != "CREATED"
    ]


def resolve_delete_queue_row(event: dict, args: dict) -> dict:
    """큐 row 영구 삭제 (관리자 수동 정리). 멱등 — 없는 콜을 지워도 ok=true.

    큐 인덱스(PK=QUEUE, SK=CALL#{id})만 지우면, 그게 마지막 행일 때 _snapshot_items의
    META fallback 스캔이 활성 콜을 되살린다. 그래서 콜 META와 고객→활성콜 포인터
    (CUST#, ACTIVE_CALL)까지 함께 제거해 행이 다시 나타나지 않게 한다.
    다른 관리자 화면에도 반영되도록 onQueueUpdate를 발화한다(델타 = 전체 재조회 트리거).
    """
    call_id = args["callId"]

    # 시연 보호 행은 삭제 거부 (프론트 버튼 숨김 + 직접 호출 방어).
    if call_id in PROTECTED_CALL_IDS:
        raise OrchestratorError(
            "FORBIDDEN", f"call {call_id} is protected and cannot be deleted",
        )

    # 고객→활성콜 포인터 정리: 이 콜을 가리킬 때만 삭제(다른 콜 발신 중이면 보존).
    meta = dynamo.get_item(dynamo.pk_call(call_id), dynamo.SK_META) or {}
    customer_id = meta.get("customerId")
    if customer_id:
        active = dynamo.get_item(dynamo.pk_cust(customer_id), "ACTIVE_CALL") or {}
        if active.get("callId") == call_id:
            dynamo.delete_item(dynamo.pk_cust(customer_id), "ACTIVE_CALL")

    dynamo.delete_item(_QUEUE_PK, dynamo.sk_call(call_id))
    dynamo.delete_item(dynamo.pk_call(call_id), dynamo.SK_META)

    # 라이브 관리자 화면 동기화 — Streams REMOVE는 NewImage가 없어 팬아웃되지 않으므로
    # 여기서 직접 발화한다. 페이로드 내용보다 "변경됨" 신호가 중요(프론트가 전체 재조회).
    _emit_queue_update(call_id)

    return {"ok": True, "callId": call_id}


def _emit_queue_update(call_id: str) -> None:
    """onQueueUpdate 구독 팬아웃. 삭제이므로 state=null. 실패는 삼킨다(삭제는 이미 완료)."""
    try:
        from ..api import stream_fanout

        stream_fanout._emit("_emitQueueUpdate", {"callId": call_id, "state": None})
    except Exception:  # noqa: BLE001 — 발화 실패가 삭제 응답을 막지 않게
        pass


def resolve_queue(event: dict, args: dict) -> dict:
    """큐 스냅샷. highlightOnly=true면 highlight 행만 반환."""
    highlight_only = bool(args.get("highlightOnly", False))
    items = _snapshot_items()
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
