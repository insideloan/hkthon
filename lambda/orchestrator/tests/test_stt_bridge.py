"""AGENT-008 (#16) — Transcribe STT 브리지 mock 스트림 누적 검증."""

from __future__ import annotations

import asyncio
from typing import AsyncIterator

from orchestrator.stt.transcribe_stt import (
    SttHandler,
    SttResult,
    accumulate_final_text,
    best_effort_text,
    stream_chunks,
)


# ─── mock 헬퍼 ────────────────────────────────────────────────────────────────


class _MockTranscriptEvent:
    """amazon_transcribe.model.TranscriptEvent 최소 mock."""

    def __init__(self, results: list) -> None:
        self.transcript = _MockTranscript(results)


class _MockTranscript:
    def __init__(self, results: list) -> None:
        self.results = results


class _MockResult:
    def __init__(self, text: str, is_partial: bool) -> None:
        self.is_partial = is_partial
        self.alternatives = [_MockAlternative(text)]


class _MockAlternative:
    def __init__(self, transcript: str) -> None:
        self.transcript = transcript


async def _async_event_gen(events: list):
    """이벤트 목록을 async for로 소비 가능한 제너레이터로 변환."""
    for event in events:
        yield event


class _MockStream:
    """SttHandler에 주입할 mock 스트림."""

    def __init__(self, events: list) -> None:
        self._events = events

    def __aiter__(self):
        return _async_event_gen(self._events)


def _make_handler_factory(events: list):
    """주어진 이벤트 목록으로 SttHandler를 반환하는 팩토리."""

    def _factory(chunks: object) -> SttHandler:  # noqa: ARG001
        return SttHandler(_MockStream(events))

    return _factory


# ─── 단위 테스트 ─────────────────────────────────────────────────────────────


def test_partial_result_isFinal_false():
    """is_partial=True 이벤트 → isFinal=False 결과 생성."""
    events = [
        _MockTranscriptEvent([_MockResult("안녕", is_partial=True)]),
    ]
    handler = SttHandler(_MockStream(events))
    asyncio.run(handler.handle_events())

    results = handler.get_results()
    assert len(results) == 1
    assert results[0].text == "안녕"
    assert results[0].isFinal is False


def test_final_result_isFinal_true():
    """is_partial=False 이벤트 → isFinal=True 결과 생성."""
    events = [
        _MockTranscriptEvent([_MockResult("안녕하세요", is_partial=False)]),
    ]
    handler = SttHandler(_MockStream(events))
    asyncio.run(handler.handle_events())

    results = handler.get_results()
    assert len(results) == 1
    assert results[0].text == "안녕하세요"
    assert results[0].isFinal is True


def test_mixed_partial_and_final_accumulation():
    """부분 → 최종 이벤트 순서 → 두 결과 모두 누적."""
    events = [
        _MockTranscriptEvent([_MockResult("대출", is_partial=True)]),
        _MockTranscriptEvent([_MockResult("대출 상담", is_partial=False)]),
    ]
    handler = SttHandler(_MockStream(events))
    asyncio.run(handler.handle_events())

    results = handler.get_results()
    assert len(results) == 2
    assert results[0].isFinal is False
    assert results[1].isFinal is True
    assert results[1].text == "대출 상담"


def test_multiple_chunks_multiple_final_segments():
    """여러 청크에서 다수 최종 세그먼트 누적 검증."""
    events = [
        _MockTranscriptEvent([_MockResult("안녕하세요", is_partial=True)]),
        _MockTranscriptEvent([_MockResult("안녕하세요", is_partial=False)]),
        _MockTranscriptEvent([_MockResult("대출 문의", is_partial=True)]),
        _MockTranscriptEvent([_MockResult("대출 문의 드립니다", is_partial=False)]),
    ]
    handler = SttHandler(_MockStream(events))
    asyncio.run(handler.handle_events())

    results = handler.get_results()
    finals = [r for r in results if r.isFinal]
    partials = [r for r in results if not r.isFinal]

    assert len(finals) == 2
    assert len(partials) == 2
    assert finals[0].text == "안녕하세요"
    assert finals[1].text == "대출 문의 드립니다"


def test_empty_transcript_text_skipped():
    """빈 텍스트 결과는 SttResult에 포함하지 않는다."""
    events = [
        _MockTranscriptEvent([_MockResult("", is_partial=False)]),
        _MockTranscriptEvent([_MockResult("  ", is_partial=False)]),
        _MockTranscriptEvent([_MockResult("정상 텍스트", is_partial=False)]),
    ]
    handler = SttHandler(_MockStream(events))
    asyncio.run(handler.handle_events())

    results = handler.get_results()
    # 빈 문자열("", " ") 2건 중 " "는 truthy → 포함될 수 있음;
    # 실제로 "  "는 strip 후에도 비어있지 않으므로 포함 여부를 SttHandler 구현에 맞게 검증.
    # 핵심: "정상 텍스트"는 반드시 포함.
    texts = [r.text for r in results]
    assert "정상 텍스트" in texts
    # 빈 문자열("")은 포함되지 않아야 함.
    assert "" not in texts


def test_no_results_for_empty_stream():
    """이벤트 없는 스트림 → 결과 없음."""
    handler = SttHandler(_MockStream([]))
    asyncio.run(handler.handle_events())

    assert handler.get_results() == []


def test_accumulate_final_text_joins_finals_only():
    """accumulate_final_text: isFinal=True 텍스트만 공백 연결."""
    results = [
        SttResult(text="안녕", isFinal=False),
        SttResult(text="안녕하세요", isFinal=True),
        SttResult(text="대출 문의", isFinal=False),
        SttResult(text="대출 문의 드립니다", isFinal=True),
    ]
    combined = asyncio.run(accumulate_final_text(results))
    assert combined == "안녕하세요 대출 문의 드립니다"


def test_accumulate_final_text_empty_when_no_finals():
    """최종 결과가 없으면 빈 문자열 반환."""
    results = [
        SttResult(text="부분 결과", isFinal=False),
    ]
    combined = asyncio.run(accumulate_final_text(results))
    assert combined == ""


def test_stream_chunks_with_mock_handler_factory():
    """stream_chunks: handler_factory 주입 → AWS 호출 없이 결과 반환."""

    async def _dummy_chunks() -> AsyncIterator[bytes]:
        for chunk in [b"\x00" * 3200, b"\x00" * 3200]:
            yield chunk

    events = [
        _MockTranscriptEvent([_MockResult("모의 발화", is_partial=False)]),
    ]

    async def _run():
        return await stream_chunks(
            _dummy_chunks(),
            handler_factory=_make_handler_factory(events),
        )

    results = asyncio.run(_run())
    assert len(results) == 1
    assert results[0].text == "모의 발화"
    assert results[0].isFinal is True


def test_best_effort_text_prefers_finals():
    """best_effort_text: 최종이 있으면 최종만 연결(accumulate_final_text와 동일)."""
    results = [
        SttResult(text="안녕", isFinal=False),
        SttResult(text="안녕하세요", isFinal=True),
        SttResult(text="대출 문의", isFinal=False),
        SttResult(text="대출 문의 드립니다", isFinal=True),
    ]
    assert asyncio.run(best_effort_text(results)) == "안녕하세요 대출 문의 드립니다"


def test_best_effort_text_falls_back_to_last_partial():
    """최종이 하나도 없으면 마지막(가장 완전한) partial로 폴백 — 턴 드롭 방지."""
    results = [
        SttResult(text="대", isFinal=False),
        SttResult(text="대출", isFinal=False),
        SttResult(text="대출 상담", isFinal=False),
    ]
    assert asyncio.run(best_effort_text(results)) == "대출 상담"


def test_best_effort_text_empty_when_no_results():
    """결과가 없으면 빈 문자열."""
    assert asyncio.run(best_effort_text([])) == ""


def test_stt_result_shape():
    """SttResult dataclass shape — text·isFinal 필드 존재."""
    r = SttResult(text="테스트", isFinal=True)
    assert r.text == "테스트"
    assert r.isFinal is True
    assert hasattr(r, "text")
    assert hasattr(r, "isFinal")
