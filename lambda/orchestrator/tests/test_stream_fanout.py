"""BACKEND-009 (#28) — Streams 팬아웃: 엔터티 → _emit* 매핑."""

from __future__ import annotations

from orchestrator.api import stream_fanout as sf


def _record(image: dict, event_name="INSERT") -> dict:
    return {"eventName": event_name, "dynamodb": {"NewImage": image}}


def _emit_names(result: dict) -> list[str]:
    return [e["mutation"] for e in result["emits"]]


def test_turn_insert_emits_turn():
    rec = _record({"PK": "CALL#c1", "SK": "TURN#0001", "seq": 1,
                   "speaker": "customer", "text": "안녕", "flag": "risk"})
    out = sf.handler({"Records": [rec]})
    assert "_emitTurn" in _emit_names(out)


def test_turn_with_analysis_also_emits_index():
    rec = _record({"PK": "CALL#c1", "SK": "TURN#0002", "seq": 2,
                   "churn_after": 62, "emotion": "불안"})
    out = sf.handler({"Records": [rec]})
    names = _emit_names(out)
    assert "_emitTurn" in names and "_emitIndexUpdate" in names


def test_mot_insert_emits_mot_new_shape():
    rec = _record({"PK": "CALL#c1", "SK": "MOT#0001", "markerId": "MOT_1",
                   "state": "ALERT", "stage": "OBJECTION", "turn_seq": 3})
    out = sf.handler({"Records": [rec]})
    emit = next(e for e in out["emits"] if e["mutation"] == "_emitMot")
    p = emit["payload"]
    assert p["markerId"] == "MOT_1" and p["state"] == "ALERT" and p["stage"] == "OBJECTION"
    for dead in ("type", "narrative", "churnBefore", "churnAfter"):
        assert dead not in p


def test_compliance_emits_state_payload():
    rec = _record({"PK": "CALL#c1", "SK": "CMPL#3#0", "state": "REDACTING",
                   "draft": "초안", "violated_policies": ["과장광고"], "final": "수정본"})
    out = sf.handler({"Records": [rec]})
    emit = next(e for e in out["emits"] if e["mutation"] == "_emitComplianceState")
    p = emit["payload"]
    assert p["state"] == "REDACTING"
    assert p["violatedPolicies"] == ["과장광고"]
    assert p["finalDiff"] == "수정본"


def test_call_ended_and_queue_and_strategy():
    rec = _record({"PK": "CALL#c1", "SK": "META", "callId": "c1", "state": "ENDED",
                   "strategy_headline": "비교 제안", "rationale": "절감"})
    out = sf.handler({"Records": [rec]})
    names = _emit_names(out)
    assert "_emitCallEnded" in names
    assert "_emitQueueUpdate" in names
    assert "_emitStrategyUpdate" in names


def test_strategy_update_two_fields_only():
    rec = _record({"PK": "CALL#c1", "SK": "META", "callId": "c1", "state": "IN_CALL",
                   "strategy_headline": "비교 제안", "rationale": "절감"})
    out = sf.handler({"Records": [rec]})
    emit = next(e for e in out["emits"] if e["mutation"] == "_emitStrategyUpdate")
    assert set(emit["payload"]) == {"callId", "strategyHeadline", "rationale"}


def test_deserialize_typed_image():
    """DynamoDB 타입태그 이미지도 평탄화한다."""
    rec = _record({"PK": {"S": "CALL#c1"}, "SK": {"S": "MOT#0001"},
                   "markerId": {"S": "MOT_1"}, "state": {"S": "SHOW"},
                   "stage": {"S": "TRUST"}, "turn_seq": {"N": "1"}})
    out = sf.handler({"Records": [rec]})
    emit = next(e for e in out["emits"] if e["mutation"] == "_emitMot")
    assert emit["payload"]["markerId"] == "MOT_1"


def test_appsync_emit_invoked_when_set():
    calls = []
    sf.set_appsync_emit(lambda m, p: calls.append(m))
    try:
        rec = _record({"PK": "CALL#c1", "SK": "TURN#0001", "seq": 1})
        sf.handler({"Records": [rec]})
        assert "_emitTurn" in calls
    finally:
        sf.set_appsync_emit(None)
