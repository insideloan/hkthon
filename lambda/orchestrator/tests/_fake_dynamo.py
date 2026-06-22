"""In-memory fake DynamoDB Table for unit tests (no moto / no AWS).

Implements the subset of boto3 Table used by orchestrator.api.dynamo:
get_item / put_item / query (PK eq + optional SK begins_with) / update_item.
Keyed by (PK, SK). Good enough for resolver round-trip tests; CI installs only
requirements.txt + pytest, so we avoid the moto dependency.
"""

from __future__ import annotations

from typing import Any


class FakeTable:
    def __init__(self) -> None:
        self.store: dict[tuple, dict[str, Any]] = {}

    # -- boto3 Table API subset -------------------------------------------------
    def put_item(self, Item: dict[str, Any]) -> dict:  # noqa: N803 (boto3 kw)
        self.store[(Item["PK"], Item["SK"])] = dict(Item)
        return {}

    def get_item(self, Key: dict[str, Any]) -> dict:  # noqa: N803
        item = self.store.get((Key["PK"], Key["SK"]))
        return {"Item": dict(item)} if item is not None else {}

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
