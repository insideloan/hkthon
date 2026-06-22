"""AppSync Lambda 데이터소스 핸들러 엔트리포인트.

BACKEND 모듈 (#20). AppSync resolver의 모든 호출이 이 Lambda로 들어온다.
`event["fieldName"]`(또는 `event["info"]["fieldName"]`)을 보고 해당 resolver
함수로 디스패치한다. REST/FastAPI/uvicorn 경로 없음 — 순수 AppSync 이벤트.

에러 규약 (API.md §0): resolver가 OrchestratorError를 던지면 errorType을
포함한 dict를 반환한다. AppSync는 이를 GraphQL 에러로 매핑한다.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Callable

logger = logging.getLogger(__name__)
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))


class OrchestratorError(Exception):
    """resolver가 던지는 도메인 에러. error_type은 API.md 규약값."""

    def __init__(self, error_type: str, message: str = "") -> None:
        super().__init__(message or error_type)
        self.error_type = error_type
        self.message = message or error_type


def _resolver_map() -> dict[str, Callable[[dict, dict], Any]]:
    """fieldName → resolver 함수 매핑. 지연 import로 콜드스타트/테스트 부담 최소화.

    구독(onTurn 등)은 AppSync `@aws_subscribe`로 자동 처리되거나 Streams 팬아웃이
    `_emit*` 뮤테이션으로 발화하므로, 여기서는 쿼리/뮤테이션 resolver만 등록한다.
    """
    from .resolvers import calls, customers, mots, queue, summaries

    return {
        # queue
        "queue": queue.resolve_queue,
        # calls (mutations + snapshot query)
        "createCall": calls.resolve_create_call,
        "dialCall": calls.resolve_dial_call,
        "call": calls.resolve_call,
        "approveProduct": calls.resolve_approve_product,
        "transferToAgent": calls.resolve_transfer_to_agent,
        "sendLink": calls.resolve_send_link,
        "endCall": calls.resolve_end_call,
        # mots
        "mots": mots.resolve_mots,
        # summaries + customers
        "callSummary": summaries.resolve_call_summary,
        "customer": customers.resolve_customer,
        "customers": customers.resolve_customers,
        # health
        "ping": lambda event, args: {"ok": True},
    }


def _field_name(event: dict) -> str:
    """AppSync 이벤트에서 fieldName 추출 (직접 resolver / VTL 패스스루 양쪽 지원)."""
    if "fieldName" in event:
        return event["fieldName"]
    info = event.get("info") or {}
    return info.get("fieldName", "")


def handler(event: dict, context: Any = None) -> Any:
    """Lambda 엔트리. AppSync 단건 이벤트를 fieldName으로 디스패치."""
    field = _field_name(event)
    args = event.get("arguments") or {}
    logger.info("dispatch fieldName=%s", field)

    resolvers = _resolver_map()
    fn = resolvers.get(field)
    if fn is None:
        logger.warning("unknown fieldName: %s", field)
        return {"error": True, "errorType": "INTERNAL",
                "message": f"unknown field: {field}"}

    try:
        return fn(event, args)
    except OrchestratorError as e:
        logger.info("resolver error %s: %s", e.error_type, e.message)
        return {"error": True, "errorType": e.error_type, "message": e.message}
    except Exception as e:  # noqa: BLE001 — 데모 안정성: 예외가 통화를 끊지 않게
        logger.exception("resolver crashed for field=%s", field)
        return {"error": True, "errorType": "INTERNAL", "message": str(e)}
