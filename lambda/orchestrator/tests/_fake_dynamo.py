"""In-memory fake DynamoDB Table for unit tests (no moto / no AWS).

Implements the subset of boto3 Table used by orchestrator.api.dynamo:
get_item / put_item / query (PK eq + optional SK begins_with) / update_item.
Keyed by (PK, SK). Good enough for resolver round-trip tests; CI installs only
requirements.txt + pytest, so we avoid the moto dependency.
"""

from __future__ import annotations

from typing import Any


class _ConditionalCheckFailed(Exception):
    """boto3 ClientError(ConditionalCheckFailedException)를 흉내내는 fake 예외.

    dynamo._is_conditional_check_failed가 response.Error.Code로 판별하므로
    동일 구조의 response 속성을 단다.
    """

    def __init__(self) -> None:
        super().__init__("ConditionalCheckFailedException")
        self.response = {"Error": {"Code": "ConditionalCheckFailedException"}}


class FakeTable:
    def __init__(self) -> None:
        self.store: dict[tuple, dict[str, Any]] = {}

    # -- boto3 Table API subset -------------------------------------------------
    def put_item(self, Item: dict[str, Any], ConditionExpression=None, **kwargs) -> dict:  # noqa: N803 (boto3 kw)
        key = (Item["PK"], Item["SK"])
        # attribute_not_exists 조건부 write: 이미 있으면 boto3와 동일하게 거부.
        if ConditionExpression is not None and "attribute_not_exists" in str(ConditionExpression):
            if key in self.store:
                raise _ConditionalCheckFailed()
        self.store[key] = dict(Item)
        return {}

    def get_item(self, Key: dict[str, Any]) -> dict:  # noqa: N803
        item = self.store.get((Key["PK"], Key["SK"]))
        return {"Item": dict(item)} if item is not None else {}

    def delete_item(self, Key: dict[str, Any]) -> dict:  # noqa: N803
        self.store.pop((Key["PK"], Key["SK"]), None)
        return {}

    def query(self, **kwargs) -> dict:
        # We don't parse the boto3 ConditionExpression object; instead the dynamo
        # helper builds it from (pk, sk_prefix). For the fake we re-derive intent
        # by scanning the condition's stored operands via a side channel is messy,
        # so query() here accepts our own _pk/_sk_prefix passthrough when present.
        pk = kwargs.get("_pk")
        sk_prefix = kwargs.get("_sk_prefix")
        if pk is None:
            # Fall back: extract from KeyConditionExpression repr (boto3 Condition).
            cond = kwargs.get("KeyConditionExpression")
            pk, sk_prefix = _parse_condition(cond)
        items = [
            dict(v)
            for (p, s), v in self.store.items()
            if p == pk and (sk_prefix is None or s.startswith(sk_prefix))
        ]
        items.sort(key=lambda it: it["SK"])
        return {"Items": items}

    def scan(self, **kwargs) -> dict:
        # dynamo.scan passes only an optional FilterExpression of Attr("SK").eq(v).
        # We re-derive the SK literal from the boto3 condition; no filter → all.
        sk = None
        cond = kwargs.get("FilterExpression")
        if cond is not None:
            try:
                expr = cond.get_expression()
                vals = expr.get("values", [])
                if getattr(vals[0], "name", None) == "SK" and expr.get("operator") == "=":
                    sk = vals[1]
            except (AttributeError, IndexError):
                sk = None
        items = [
            dict(v)
            for (_p, s), v in self.store.items()
            if sk is None or s == sk
        ]
        items.sort(key=lambda it: (it["PK"], it["SK"]))
        return {"Items": items}

    def update_item(self, **kwargs) -> dict:
        key = (kwargs["Key"]["PK"], kwargs["Key"]["SK"])
        item = self.store.setdefault(key, {"PK": key[0], "SK": key[1]})
        names = kwargs.get("ExpressionAttributeNames", {})
        values = kwargs.get("ExpressionAttributeValues", {})
        # Parse "SET #k0 = :v0, #k1 = :v1"
        expr = kwargs["UpdateExpression"].removeprefix("SET ").strip()
        for assign in expr.split(","):
            lhs, rhs = (p.strip() for p in assign.split("="))
            item[names.get(lhs, lhs)] = values[rhs]
        return {"Attributes": dict(item)}


def _parse_condition(cond) -> tuple:
    """Best-effort extraction of (pk, sk_prefix) from a boto3 Condition object.

    boto3 conditions expose `.get_expression()` with values nested; we read the
    operand values. Falls back to (None, None) which yields an empty query.
    """
    try:
        expr = cond.get_expression()
    except AttributeError:
        return (None, None)

    pk = None
    sk_prefix = None

    def walk(e):
        nonlocal pk, sk_prefix
        # Nested Condition object → expand to its expression dict.
        if hasattr(e, "get_expression"):
            e = e.get_expression()
        if not isinstance(e, dict):
            return
        op = e.get("operator")
        vals = e.get("values", [])
        if op == "AND":
            for v in vals:
                walk(v)
            return
        # vals[0] is a Key/Attr (has .name), vals[1] is the literal.
        name = getattr(vals[0], "name", None) if vals else None
        literal = vals[1] if len(vals) > 1 else None
        if name == "PK" and op == "=":
            pk = literal
        elif name == "SK" and op == "begins_with":
            sk_prefix = literal

    walk(expr)
    return (pk, sk_prefix)
