"""BACKEND-010 (#29) — 오디오 글루: STT mock → Turn 기록, script 모드 no-op."""

from __future__ import annotations

import base64

import pytest

from orchestrator.api import audio, dynamo
from orchestrator.api import config

from ._fake_dynamo import FakeTable


@pytest.fixture(autouse=True)
def _fake_table():
    dynamo.set_table(FakeTable())
    yield
    dynamo.set_table(None)
    config.get_settings.cache_clear()


def test_script_mode_noop(monkeypatch):
    monkeypatch.setenv("ORCHESTRATOR_MODE", "script")
    config.get_settings.cache_clear()
    assert audio.resolve_audio_chunk({}, {"callId": "c1", "data": "AAAA"}) is False
    assert audio.resolve_start_audio({}, {"callId": "c1"}) is False


def test_live_mode_audio_chunk_records_turn(monkeypatch):
    monkeypatch.setenv("ORCHESTRATOR_MODE", "live")
    config.get_settings.cache_clear()

    # AGENT STT 브리지를 mock: stream_chunks → results, best_effort_text → text.
    from orchestrator.stt import transcribe_stt

    async def fake_stream_chunks(chunks, **kw):
        # 청크 소비(데모): 텍스트 결과 대체.
        async for _ in chunks:
            pass
        return ["sentinel"]

    async def fake_accumulate(results):
        return "금리가 높아요"

    monkeypatch.setattr(transcribe_stt, "stream_chunks", fake_stream_chunks)
    monkeypatch.setattr(transcribe_stt, "best_effort_text", fake_accumulate)

    data = base64.b64encode(b"\x00\x01").decode()
    ok = audio.resolve_audio_chunk({}, {"callId": "c1", "data": data})
    assert ok is True
    turns = dynamo.query(dynamo.pk_call("c1"), dynamo.SK_PREFIX_TURN)
    assert turns[0]["text"] == "금리가 높아요"
    assert turns[0]["speaker"] == "customer"


def test_live_mode_empty_text_no_turn(monkeypatch):
    monkeypatch.setenv("ORCHESTRATOR_MODE", "live")
    config.get_settings.cache_clear()
    from orchestrator.stt import transcribe_stt

    async def fake_stream_chunks(chunks, **kw):
        async for _ in chunks:
            pass
        return []

    async def fake_accumulate(results):
        return ""

    monkeypatch.setattr(transcribe_stt, "stream_chunks", fake_stream_chunks)
    monkeypatch.setattr(transcribe_stt, "best_effort_text", fake_accumulate)
    assert audio.resolve_audio_chunk({}, {"callId": "c1", "data": "AAAA"}) is False
    assert dynamo.query(dynamo.pk_call("c1"), dynamo.SK_PREFIX_TURN) == []


def test_live_mode_punctuation_noise_no_turn(monkeypatch):
    """STT가 구두점·공백뿐인 잡음('.')을 돌려주면 Turn도 그래프도 트리거 안 함(폭주 방지)."""
    monkeypatch.setenv("ORCHESTRATOR_MODE", "live")
    config.get_settings.cache_clear()
    from orchestrator.stt import transcribe_stt

    async def fake_stream_chunks(chunks, **kw):
        async for _ in chunks:
            pass
        return []

    async def fake_accumulate(results):
        return "."  # 무음 구간을 STT가 구두점으로 인식한 케이스

    ran = {"agent": False}
    monkeypatch.setattr(transcribe_stt, "stream_chunks", fake_stream_chunks)
    monkeypatch.setattr(transcribe_stt, "best_effort_text", fake_accumulate)
    monkeypatch.setattr(audio, "_run_agent_turn", lambda *a, **k: ran.__setitem__("agent", True))
    assert audio.resolve_audio_chunk({}, {"callId": "c1", "data": "AAAA"}) is False
    assert dynamo.query(dynamo.pk_call("c1"), dynamo.SK_PREFIX_TURN) == []
    assert ran["agent"] is False  # 그래프 미실행


def test_has_speech_helper():
    """의미 글자(한/영/숫자)가 있으면 True, 구두점·공백뿐이면 False."""
    assert audio._has_speech("여보세요") is True
    assert audio._has_speech("네") is True
    assert audio._has_speech("음.") is True       # 의미 글자 '음' 포함 → 통과(silence 노드가 처리)
    assert audio._has_speech(".") is False
    assert audio._has_speech("...") is False
    assert audio._has_speech("  ?  ") is False
    assert audio._has_speech("") is False


def test_audio_chunk_uses_max_seq_not_count(monkeypatch):
    """seq는 len(turns)+1이 아니라 max(seq)+1 — 누락/혼합 seq에도 충돌 없이 다음 값."""
    monkeypatch.setenv("ORCHESTRATOR_MODE", "live")
    config.get_settings.cache_clear()
    from orchestrator.stt import transcribe_stt

    # 기존 Turn: seq 1, 2(봇), 4(seq 3 누락 — len=3이면 seq=4 충돌 위험).
    for s in (1, 2, 4):
        dynamo.put_item({"PK": dynamo.pk_call("c1"), "SK": dynamo.sk_turn(s), "seq": s, "speaker": "bot"})

    async def fake_stream_chunks(chunks, **kw):
        async for _ in chunks:
            pass
        return []

    async def fake_accumulate(results):
        return "다음 발화"

    monkeypatch.setattr(transcribe_stt, "stream_chunks", fake_stream_chunks)
    monkeypatch.setattr(transcribe_stt, "best_effort_text", fake_accumulate)
    monkeypatch.setattr(audio, "_run_agent_turn", lambda *a, **k: None)

    assert audio.resolve_audio_chunk({}, {"callId": "c1", "data": "AAAA"}) is True
    # max(1,2,4)+1 = 5 (len+1=4가 아님 → 기존 seq 4를 덮어쓰지 않음).
    new = dynamo.get_item(dynamo.pk_call("c1"), dynamo.sk_turn(5))
    assert new is not None and new["text"] == "다음 발화"
    assert dynamo.get_item(dynamo.pk_call("c1"), dynamo.sk_turn(4))["speaker"] == "bot"


def test_audio_chunk_seq_collision_retries(monkeypatch):
    """조건부 write 충돌 시 seq를 재계산해 재시도 — 동시 invocation이 선점한 케이스."""
    monkeypatch.setenv("ORCHESTRATOR_MODE", "live")
    config.get_settings.cache_clear()
    from orchestrator.stt import transcribe_stt

    async def fake_stream_chunks(chunks, **kw):
        async for _ in chunks:
            pass
        return []

    async def fake_accumulate(results):
        return "내 발화"

    monkeypatch.setattr(transcribe_stt, "stream_chunks", fake_stream_chunks)
    monkeypatch.setattr(transcribe_stt, "best_effort_text", fake_accumulate)
    monkeypatch.setattr(audio, "_run_agent_turn", lambda *a, **k: None)

    # 첫 put_item_if_absent 직전에 다른 invocation이 seq=1을 선점하도록 가로챈다.
    real_put = dynamo.put_item_if_absent
    calls = {"n": 0}

    def racing_put(item):
        if calls["n"] == 0:
            calls["n"] += 1
            # 경쟁자가 seq=1을 먼저 차지 → 우리 write는 충돌해야 한다.
            dynamo.put_item({"PK": item["PK"], "SK": item["SK"], "seq": item["seq"],
                             "speaker": "customer", "text": "경쟁자"})
        return real_put(item)

    monkeypatch.setattr(dynamo, "put_item_if_absent", racing_put)

    assert audio.resolve_audio_chunk({}, {"callId": "c1", "data": "AAAA"}) is True
    # 경쟁자가 seq=1을 차지했으므로 우리 발화는 seq=2로 안착(덮어쓰기 없음).
    assert dynamo.get_item(dynamo.pk_call("c1"), dynamo.sk_turn(1))["text"] == "경쟁자"
    assert dynamo.get_item(dynamo.pk_call("c1"), dynamo.sk_turn(2))["text"] == "내 발화"


def test_live_mode_start_audio(monkeypatch):
    monkeypatch.setenv("ORCHESTRATOR_MODE", "live")
    config.get_settings.cache_clear()
    assert audio.resolve_start_audio({}, {"callId": "c1"}) is True
