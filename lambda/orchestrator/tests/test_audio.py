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

    # AGENT STT 브리지를 mock: stream_chunks → results, accumulate_final_text → text.
    from orchestrator.stt import transcribe_stt

    async def fake_stream_chunks(chunks, **kw):
        # 청크 소비(데모): 텍스트 결과 대체.
        async for _ in chunks:
            pass
        return ["sentinel"]

    async def fake_accumulate(results):
        return "금리가 높아요"

    monkeypatch.setattr(transcribe_stt, "stream_chunks", fake_stream_chunks)
    monkeypatch.setattr(transcribe_stt, "accumulate_final_text", fake_accumulate)

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
    monkeypatch.setattr(transcribe_stt, "accumulate_final_text", fake_accumulate)
    assert audio.resolve_audio_chunk({}, {"callId": "c1", "data": "AAAA"}) is False
    assert dynamo.query(dynamo.pk_call("c1"), dynamo.SK_PREFIX_TURN) == []


def test_live_mode_start_audio(monkeypatch):
    monkeypatch.setenv("ORCHESTRATOR_MODE", "live")
    config.get_settings.cache_clear()
    assert audio.resolve_start_audio({}, {"callId": "c1"}) is True
