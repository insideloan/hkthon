"""PLACEHOLDER orchestrator handler (infra-owned).

Proves the AppSync -> Lambda -> DynamoDB path works end-to-end in script mode,
before the real orchestrator bundle ships in CLOUD-008 (#50). It resolves the
placeholder schema's `createCall` / `nextTurn` mutations by writing real items
to the single DynamoDB table.

Replaced wholesale by AGENT/BACKEND's lambda/orchestrator/ bundle in #50.
No secrets are read here; TABLE_NAME comes from the environment.
"""
import logging
import os
import time

import boto3

log = logging.getLogger()
log.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

_TABLE_NAME = os.environ["TABLE_NAME"]
_ddb = boto3.resource("dynamodb").Table(_TABLE_NAME)

# Fixed script-mode turns, cycled by seq. The real scenario.json drives this in
# the live bundle (#50); here a tiny canned exchange proves the write path.
_SCRIPT = [
    {"speaker": "agent", "text": "안녕하세요, AI 상담원입니다."},
    {"speaker": "customer", "text": "네, 안녕하세요."},
    {"speaker": "agent", "text": "무엇을 도와드릴까요?"},
]


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _create_call(customer_id: str) -> dict:
    call_id = f"c{int(time.time() * 1000)}"
    item = {
        "PK": f"CALL#{call_id}",
        "SK": "META",
        "callId": call_id,
        "customerId": customer_id,
        "state": "CREATED",
        "startedAt": _now(),
    }
    _ddb.put_item(Item=item)
    log.info("createCall -> %s", call_id)
    return {"callId": call_id, "customerId": customer_id,
            "state": "CREATED", "startedAt": item["startedAt"]}


def _next_turn(call_id: str) -> dict:
    # Count existing turns to pick the next seq (script-mode cycling).
    resp = _ddb.query(
        KeyConditionExpression="PK = :pk AND begins_with(SK, :t)",
        ExpressionAttributeValues={":pk": f"CALL#{call_id}", ":t": "TURN#"},
        Select="COUNT",
    )
    seq = int(resp.get("Count", 0))
    line = _SCRIPT[seq % len(_SCRIPT)]
    item = {
        "PK": f"CALL#{call_id}",
        "SK": f"TURN#{seq:04d}",
        "callId": call_id,
        "seq": seq,
        "speaker": line["speaker"],
        "text": line["text"],
    }
    _ddb.put_item(Item=item)
    log.info("nextTurn %s -> seq %d", call_id, seq)
    return {"callId": call_id, "seq": seq,
            "speaker": line["speaker"], "text": line["text"]}


def handler(event, context):
    # AppSync Lambda data source sends {info:{fieldName}, arguments:{...}}.
    field = (event.get("info") or {}).get("fieldName", "")
    args = event.get("arguments") or {}
    log.info("invoke field=%s args=%s", field, args)

    if field == "createCall":
        return _create_call(args.get("customerId", "unknown"))
    if field == "nextTurn":
        return _next_turn(args["callId"])

    # Unknown field — placeholder default.
    return {"ok": True, "mode": "script", "field": field,
            "note": "scaffold placeholder"}
