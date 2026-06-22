"""customer / customers 쿼리 resolver (BACKEND #27)."""

from __future__ import annotations

from ..api import dynamo
from ..handler import OrchestratorError


def _customer_out(item: dict) -> dict:
    return {
        "id": item.get("customerId"),
        "name": item.get("name"),
        "phone": item.get("phone"),
        "targetProduct": item.get("target_product"),
        "rate": item.get("rate"),
        "limit": item.get("limit"),
        "existingLoans": {
            "own": (item.get("existing_loans") or {}).get("own", 0),
            "other": (item.get("existing_loans") or {}).get("other", 0),
        },
        "hasVehicle": bool(item.get("has_vehicle", False)),
        "creditScore": item.get("credit_score"),
        "scenarioHint": item.get("scenario_hint"),
    }


def resolve_customer(event: dict, args: dict) -> dict:
    """단일 고객 전체 정보. 없으면 NOT_FOUND."""
    cid = args["id"]
    item = dynamo.get_item(dynamo.pk_cust(cid), dynamo.SK_META)
    if not item:
        raise OrchestratorError("NOT_FOUND", f"customer not found: {cid}")
    return _customer_out(item)


def resolve_customers(event: dict, args: dict) -> list[dict]:
    """고객 목록. 싱글 테이블에 고객 인덱스(PK=CUSTOMERS, SK=CUST#{id})를 사용."""
    items = dynamo.query("CUSTOMERS", "CUST#")
    return [_customer_out(i) for i in items]
