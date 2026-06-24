"""BACKEND-009 (#28) — Streams 팬아웃: 엔터티 → _emit* 매핑."""

from __future__ import annotations

import pytest

from orchestrator.api import stream_fanout as sf


@pytest.fixture(autouse=True)
def _no_external_emit(monkeypatch):
    """외부 AppSync 호출 차단 — 매핑 로직만 검증 (set_appsync_emit 미사용 경로)."""
    monkeypatch.setattr(sf, "_DISABLE_EMIT", True)
    monkeypatch.setattr(sf, "_appsync_emit", None)


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


def test_index_update_carries_db_chips_and_nodes():
    """체험 preset의 DB분석(db_chips/db_nodes)이 _emitIndexUpdate payload에 실린다."""
    rec = _record({
        "PK": "CALL#exp-1", "SK": "TURN#0002", "seq": 2,
        "db_chips": ["보유 대출", "신용평가"],
        "db_nodes": [{"label": "현재 금리", "val": "13%대", "tone": "warn"}],
    })
    out = sf.handler({"Records": [rec]})
    idx = next(e for e in out["emits"] if e["mutation"] == "_emitIndexUpdate")
    assert idx["payload"]["dbChips"] == ["보유 대출", "신용평가"]
    assert idx["payload"]["dbNodes"] == [{"label": "현재 금리", "val": "13%대", "tone": "warn"}]


def test_index_node_input_drops_malformed():
    """label 없는 노드는 _db_node_inputs가 방어적으로 걸러낸다."""
    rec = _record({
        "PK": "CALL#exp-1", "SK": "TURN#0003", "seq": 3,
        "db_nodes": [{"val": "라벨없음"}, {"label": "정상", "val": "ok"}],
    })
    out = sf.handler({"Records": [rec]})
    idx = next(e for e in out["emits"] if e["mutation"] == "_emitIndexUpdate")
    assert idx["payload"]["dbNodes"] == [{"label": "정상", "val": "ok", "tone": None}]


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
    # AGENT가 저장하는 실제 형상: 소문자 state, final_text → SSOT-3 풍부 payload.
    rec = _record({"PK": "CALL#c1", "SK": "CMPL#3#0", "state": "redacting",
                   "draft": "초안", "violated_policies": ["금융소비자보호법"],
                   "final_text": "수정본"})
    out = sf.handler({"Records": [rec]})
    emit = next(e for e in out["emits"] if e["mutation"] == "_emitComplianceState")
    p = emit["payload"]
    assert p["phase"] == "REDACTING"          # 소문자 state → wire 대문자 phase enum
    assert p["violatedPolicies"] == ["금융소비자보호법"]
    assert p["final"] == [{"text": "수정본"}]   # final_text → final 세그먼트
    # 4규제 checks: reviewing 이후이므로 flagged 산출(위반 라벨만 True).
    laws = {c["law"]: c["flagged"] for c in p["checks"]}
    assert len(p["checks"]) == 4
    assert laws["금융소비자보호법"] is True
    assert laws["개인정보법"] is False


def test_compliance_checks_unreviewed_in_drafting():
    # drafting 단계: 아직 미검토 → 모든 check flagged=None.
    rec = _record({"PK": "CALL#c1", "SK": "CMPL#1#0", "state": "drafting", "draft": "초안"})
    out = sf.handler({"Records": [rec]})
    p = next(e for e in out["emits"] if e["mutation"] == "_emitComplianceState")["payload"]
    assert all(c["flagged"] is None for c in p["checks"])


def test_turn_with_tokens_emits_speech_analysis():
    # 분석 토큰이 실린 턴 → onSpeechAnalysis도 발화(카드① 채움).
    rec = _record({"PK": "CALL#c1", "SK": "TURN#0003", "seq": 3, "speaker": "customer",
                   "text": "금리가 높아요",
                   "tokens": [{"text": "금리", "polarity": "CONS", "reason": "가격저항"}]})
    out = sf.handler({"Records": [rec]})
    emit = next(e for e in out["emits"] if e["mutation"] == "_emitSpeechAnalysis")
    p = emit["payload"]
    assert p["turnSeq"] == 3
    assert p["tokens"][0]["text"] == "금리" and p["tokens"][0]["polarity"] == "CONS"


def test_call_ended_carries_result_type_and_ended_at():
    rec = _record({"PK": "CALL#c1", "SK": "META", "callId": "c1", "state": "ENDED",
                   "ended_at": "2026-06-24T00:00:00Z", "handoff_reason": "한도조회 요청"})
    out = sf.handler({"Records": [rec]})
    p = next(e for e in out["emits"] if e["mutation"] == "_emitCallEnded")["payload"]
    assert p["resultType"] == "한도조회_상담원연결"
    assert p["endedAt"] == "2026-06-24T00:00:00Z"


def test_call_ended_and_queue_and_strategy():
    rec = _record({"PK": "CALL#c1", "SK": "META", "callId": "c1", "state": "ENDED",
                   "strategy_headline": "비교 제안", "rationale": "절감"})
    out = sf.handler({"Records": [rec]})
    names = _emit_names(out)
    assert "_emitCallEnded" in names
    assert "_emitQueueUpdate" in names
    assert "_emitStrategyUpdate" in names


def test_strategy_update_payload_shape():
    rec = _record({"PK": "CALL#c1", "SK": "META", "callId": "c1", "state": "IN_CALL",
                   "strategy_headline": "비교 제안", "rationale": "절감", "last_seq": 4})
    out = sf.handler({"Records": [rec]})
    emit = next(e for e in out["emits"] if e["mutation"] == "_emitStrategyUpdate")
    p = emit["payload"]
    assert p["strategyHeadline"] == "비교 제안" and p["rationale"] == "절감"
    assert p["turnSeq"] == 4  # 어느 턴의 전략인지 식별


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
