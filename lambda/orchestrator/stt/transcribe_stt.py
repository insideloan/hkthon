"""AWS Transcribe Streaming STT 브리지 / Transcribe Streaming STT bridge.

AGENT 모듈. 이슈: AGENT-008 (#16).
2–3초 오디오 청크 → {text, isFinal} 결과를 생성(yield)한다.
언어: ko-KR.

설계 원칙:
- TranscribeStreamingClient·TranscriptResultStreamHandler는 인터페이스 경계로만 참조 →
  단위테스트에서 mock 스트림으로 완전 대체 가능.
- STT 결과 핸들러(SttHandler)를 추상화하여 AWS 실호출 없이 테스트 가능.
- is_partial=True  → isFinal=False (중간 결과)
- is_partial=False → isFinal=True  (최종 확정 결과)
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import AsyncIterator, Callable, List, Optional

logger = logging.getLogger(__name__)

# ─── 공개 타입 ────────────────────────────────────────────────────────────────


@dataclass
class SttResult:
    """STT 변환 단위 결과.

    Attributes:
        text:    인식된 텍스트 (ko-KR).
        isFinal: True → 세그먼트 확정(is_partial=False), False → 중간 결과.
    """

    text: str
    isFinal: bool


# ─── 핸들러 추상화 ────────────────────────────────────────────────────────────


class SttHandler:
    """Transcribe 이벤트 스트림을 처리하는 핸들러 기반 클래스.

    amazon_transcribe.handlers.TranscriptResultStreamHandler와 동일한
    handle_events() / handle_transcript_event() 인터페이스를 제공하되,
    결과를 _results 큐에 적재하여 단위테스트에서 mock 가능하게 설계.
    """

    def __init__(self, transcript_result_stream: object) -> None:
        self._stream = transcript_result_stream
        self._results: List[SttResult] = []

    async def handle_events(self) -> None:
        """스트림에서 TranscriptEvent를 소비한다."""
        async for event in self._stream:  # type: ignore[union-attr]
            # amazon_transcribe.model.TranscriptEvent 타입 가드
            if hasattr(event, "transcript"):
                await self.handle_transcript_event(event)

    async def handle_transcript_event(self, transcript_event: object) -> None:
        """TranscriptEvent → SttResult 변환 후 _results에 추가.

        is_partial=False(최종) → isFinal=True 로 매핑.
        """
        transcript = getattr(transcript_event, "transcript", None)
        if transcript is None:
            return

        for result in getattr(transcript, "results", []):
            is_partial: bool = getattr(result, "is_partial", True)
            alternatives = getattr(result, "alternatives", None) or []
            if not alternatives:
                continue

            text: str = getattr(alternatives[0], "transcript", "") or ""
            if not text:
                continue

            stt_result = SttResult(text=text, isFinal=not is_partial)
            self._results.append(stt_result)
            logger.debug(
                "STT 결과 수신: text=%r isFinal=%s", text, stt_result.isFinal
            )

    def get_results(self) -> List[SttResult]:
        """수집된 STT 결과 목록 반환."""
        return list(self._results)


# ─── 고수준 API ───────────────────────────────────────────────────────────────


async def stream_chunks(
    chunks: AsyncIterator[bytes],
    *,
    region: str = "ap-northeast-2",
    sample_rate_hz: int = 16000,
    media_encoding: str = "pcm",
    handler_factory: Optional[Callable[[object], SttHandler]] = None,
) -> List[SttResult]:
    """오디오 청크 스트림을 AWS Transcribe에 전송하고 STT 결과 목록을 반환.

    Args:
        chunks:          AsyncIterator[bytes] — 2–3초 단위 PCM 청크.
        region:          AWS 리전 (기본 ap-northeast-2).
        sample_rate_hz:  샘플레이트 (기본 16000 Hz).
        media_encoding:  미디어 인코딩 (기본 pcm).
        handler_factory: 테스트 시 mock SttHandler 주입용 팩토리.
                         None이면 TranscribeStreamingClient 실호출.

    Returns:
        SttResult 목록 (중간 + 최종 결과 순서대로).
    """
    if handler_factory is not None:
        # 테스트·로컬: 주입된 팩토리로 핸들러 생성 (AWS 호출 없음)
        handler = handler_factory(chunks)
        await handler.handle_events()
        return handler.get_results()

    # 실 AWS 호출 경로 (런타임)
    try:
        from amazon_transcribe.client import TranscribeStreamingClient  # noqa: PLC0415
    except ImportError as exc:
        raise RuntimeError(
            "amazon-transcribe 패키지가 설치되지 않았습니다. "
            "`pip install amazon-transcribe` 를 실행하세요."
        ) from exc

    client = TranscribeStreamingClient(region=region)
    stream = await client.start_stream_transcription(
        language_code="ko-KR",
        media_sample_rate_hz=sample_rate_hz,
        media_encoding=media_encoding,
    )

    async def _send_audio() -> None:
        async for chunk in chunks:
            await stream.input_stream.send_audio_event(audio_chunk=chunk)
        await stream.input_stream.end_stream()

    handler = SttHandler(stream.output_stream)
    await asyncio.gather(_send_audio(), handler.handle_events())
    return handler.get_results()


async def accumulate_final_text(results: List[SttResult]) -> str:
    """최종(isFinal=True) 결과 텍스트만 공백으로 이어 반환.

    Args:
        results: stream_chunks() 반환값.

    Returns:
        최종 세그먼트들을 순서대로 연결한 전체 발화 문자열.
    """
    return " ".join(r.text for r in results if r.isFinal)
