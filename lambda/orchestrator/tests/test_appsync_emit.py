"""BACKEND #28 — AppSync emit 클라이언트: 쿼리 빌드 + variables 필터 (네트워크 없음)."""

from __future__ import annotations

from orchestrator.api import appsync_emit as ae


def test_filter_vars_drops_unknown_and_none():
    """payload의 미지 필드(extra)와 None은 제거, 스키마 인자만 남는다.

    tokens는 _emitTurn의 정식 인자(schema.graphql)이므로 유지된다.
    """
    payload = {
        "callId": "c1", "seq": 1, "speaker": "customer", "text": "안녕",
        "flag": "RISK", "tokens": [{"text": "x"}],
        "extra": None,
    }
    out = ae._filter_vars("_emitTurn", payload)
    assert out == {"callId": "c1", "seq": 1, "speaker": "customer",
                   "text": "안녕", "flag": "RISK", "tokens": [{"text": "x"}]}
    assert "extra" not in out


def test_filter_vars_drops_none_values():
    payload = {"callId": "c1", "churnRisk": None, "emotion": "불안"}
    out = ae._filter_vars("_emitIndexUpdate", payload)
    assert out == {"callId": "c1", "emotion": "불안"}


def test_build_query_typed_vars():
    q = ae._build_query("_emitMot", ae._EMIT_ARGS["_emitMot"])
    assert "mutation Emit(" in q
    assert "$markerId: MotMarkerId!" in q
    assert "_emitMot(callId: $callId" in q
    # selection set은 payload 타입의 전체 필드여야 한다(callId만 고르면 나머지가
    # 구독자에게 null로 도착해 프론트 검증이 깨진다).
    assert "{ callId markerId state stage }" in q


def test_build_query_selects_full_payload():
    """_emitTurn은 seq/speaker/text 등 전체 필드를 selection에 포함해야 한다."""
    q = ae._build_query("_emitTurn", ae._EMIT_ARGS["_emitTurn"])
    for f in ("seq", "speaker", "text", "flag", "audioUrl"):
        assert f in q, f"selection set에 {f} 누락"
    assert "tokens { text polarity reason }" in q


def test_build_query_no_args():
    # 인자 없는 빌드 경로(빈 dict)는 알 수 없는 뮤테이션 → 기본 callId selection.
    q = ae._build_query("_x", {})
    assert q == "mutation Emit { _x { callId } }"


def test_emit_calls_sign_and_post(monkeypatch):
    """emit이 필터된 variables + 타입 쿼리로 _sign_and_post를 호출한다."""
    captured = {}

    def fake_post(url, body):
        import json
        captured["url"] = url
        captured["body"] = json.loads(body.decode())
        return {"data": {"_emitMot": {"callId": "c1"}}}

    monkeypatch.setenv("APPSYNC_URL", "https://example.appsync-api.x.amazonaws.com/graphql")
    monkeypatch.setattr(ae, "_sign_and_post", fake_post)

    ae.emit("_emitMot", {"callId": "c1", "markerId": "MOT_1", "state": "ALERT",
                         "stage": "OBJECTION", "turnSeq": 3})  # turnSeq 제외돼야
    assert captured["body"]["variables"] == {
        "callId": "c1", "markerId": "MOT_1", "state": "ALERT", "stage": "OBJECTION",
    }
    assert "turnSeq" not in captured["body"]["variables"]
    assert "_emitMot" in captured["body"]["query"]


def test_emit_serializes_decimal(monkeypatch):
    """DynamoDB Streams 숫자(Decimal)도 JSON 직렬화된다 (라이브 회귀 방지)."""
    import decimal
    captured = {}

    def fake_post(url, body):
        import json
        captured["body"] = json.loads(body.decode())
        return {"data": {}}

    monkeypatch.setenv("APPSYNC_URL", "https://x/graphql")
    monkeypatch.setattr(ae, "_sign_and_post", fake_post)
    ae.emit("_emitIndexUpdate", {"callId": "c1", "churnRisk": decimal.Decimal("62"),
                                 "emotion": "불안"})
    assert captured["body"]["variables"]["churnRisk"] == 62  # int로 직렬화


def test_emit_logs_graphql_errors(monkeypatch, caplog):
    monkeypatch.setenv("APPSYNC_URL", "https://x/graphql")
    monkeypatch.setattr(ae, "_sign_and_post",
                        lambda url, body: {"errors": [{"message": "bad"}]})
    import logging
    with caplog.at_level(logging.ERROR):
        ae.emit("_emitCallEnded", {"callId": "c1"})
    assert any("errors" in r.message for r in caplog.records)
