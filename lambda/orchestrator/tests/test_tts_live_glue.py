"""TTS 라이브 글루 — persist의 봇 발화 TTS 합성 → Turn.audio_url → 팬아웃 audioUrl.

봇 음성 출력 경로(LANGGRAPH-DESIGN §2.1 끝단): persist가 bot_text를 Typecast로
합성→S3 업로드→presigned URL을 Turn 아이템 audio_url에 실으면, stream_fanout이
_emitTurn(audioUrl)로 팬아웃해 프론트가 재생한다. TTS 미설정/실패는 텍스트 파이프라인을
막지 않는다(best-effort).
"""

from __future__ import annotations

from orchestrator.api import dynamo, stream_fanout as sf


# ── stream_fanout 패스스루 (의존성 없는 순수 매핑) ──────────────────────────────


def test_fanout_passes_audio_url_through():
    """봇 Turn 아이템의 audio_url → _emitTurn payload audioUrl."""
    rec = {"eventName": "INSERT", "dynamodb": {"NewImage": {
        "PK": "CALL#c1", "SK": "TURN#0002", "seq": 2, "speaker": "bot",
        "text": "안내드릴게요", "audio_url": "https://s3/presigned/abc.mp3",
    }}}
    out = sf.handler({"Records": [rec]})
    emit = next(e for e in out["emits"] if e["mutation"] == "_emitTurn")
    assert emit["payload"]["audioUrl"] == "https://s3/presigned/abc.mp3"


def test_fanout_omits_audio_url_when_absent():
    """customer Turn(또는 TTS 미생성) → audioUrl 키 없음(프론트는 null 처리)."""
    rec = {"eventName": "INSERT", "dynamodb": {"NewImage": {
        "PK": "CALL#c1", "SK": "TURN#0001", "seq": 1, "speaker": "customer",
        "text": "금리가요?",
    }}}
    out = sf.handler({"Records": [rec]})
    emit = next(e for e in out["emits"] if e["mutation"] == "_emitTurn")
    assert "audioUrl" not in emit["payload"]


# ── persist의 _synthesize_bot_audio (TTS 호출 격리) ─────────────────────────────


def test_synthesize_skips_without_api_key(monkeypatch):
    """TYPECAST_API_KEY 미설정 → 합성 시도 없이 None(무비용 경로)."""
    from orchestrator.agent import nodes

    monkeypatch.delenv("TYPECAST_API_KEY", raising=False)
    assert nodes._synthesize_bot_audio("안녕하세요", "c1", 2) is None


def test_synthesize_skips_empty_text(monkeypatch):
    from orchestrator.agent import nodes

    monkeypatch.setenv("TYPECAST_API_KEY", "k")
    assert nodes._synthesize_bot_audio("", "c1", 2) is None
    assert nodes._synthesize_bot_audio("   ", "c1", 2) is None


def test_synthesize_returns_url_on_success(monkeypatch):
    """API 키 있고 typecast_tts.synthesize 성공 → presigned URL 반환."""
    from orchestrator.agent import nodes
    from orchestrator.tts import typecast_tts

    monkeypatch.setenv("TYPECAST_API_KEY", "k")

    def fake_synth(text, voice_name="혜라", *, s3_uploader=None, s3_key=None):
        assert text == "안내드릴게요"
        assert s3_key == "tts/c1/0002.mp3"  # call_id/seq 키 규약
        return b"\xff\xfb", "https://s3/presigned/x.mp3"

    monkeypatch.setattr(typecast_tts, "synthesize", fake_synth)
    url = nodes._synthesize_bot_audio("안내드릴게요", "c1", 2)
    assert url == "https://s3/presigned/x.mp3"


def test_synthesize_swallows_tts_error(monkeypatch):
    """TTS 실패 → None(통화/텍스트 파이프라인 격리). 예외 전파 안 함."""
    from orchestrator.agent import nodes
    from orchestrator.tts import typecast_tts

    monkeypatch.setenv("TYPECAST_API_KEY", "k")

    def boom(*a, **k):
        raise typecast_tts.TtsError("TTS_ERROR: boom")

    monkeypatch.setattr(typecast_tts, "synthesize", boom)
    assert nodes._synthesize_bot_audio("안내드릴게요", "c1", 2) is None


# ── persist 통합: 봇 Turn에 audio_url 기록 + state 노출 ──────────────────────────


def test_persist_records_audio_url_on_bot_turn(monkeypatch):
    """persist가 합성 URL을 봇 Turn 아이템과 state에 실어 fanout/runner가 쓰게 한다."""
    from orchestrator.agent import nodes
    from orchestrator.agent.state import Stage

    dynamo.set_table(_FakeTable())
    monkeypatch.setattr(nodes, "_synthesize_bot_audio", lambda *a: "https://s3/x.mp3")
    try:
        state = {
            "call_id": "c1", "next_seq": 2, "bot_text": "네 안내드릴게요",
            "stage": Stage.PROPOSE, "churn_after": 40, "churn_tokens": [],
        }
        out = nodes.persist(state)
        assert out["audio_url"] == "https://s3/x.mp3"
        bot = dynamo.get_item(dynamo.pk_call("c1"), dynamo.sk_turn(2))
        assert bot["audio_url"] == "https://s3/x.mp3"
    finally:
        dynamo.set_table(None)


def _FakeTable():
    from ._fake_dynamo import FakeTable

    return FakeTable()
