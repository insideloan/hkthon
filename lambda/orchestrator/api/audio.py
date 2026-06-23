"""오디오 파이프라인 글루 (BACKEND #29).

서버리스: /ws/audio WebSocket 서버 없음. audioChunk/startAudio 뮤테이션이
라이브 모드에서 AGENT STT 브리지(lambda/orchestrator/stt/*)를 호출하고 결과를
DynamoDB Turn으로 기록한다. 스크립트 모드(ORCHESTRATOR_MODE=script)에서는 no-op.

STT/TTS 구현 자체는 AGENT 소유 — 본 모듈은 글루/뮤테이션 레이어만.
"""

from __future__ import annotations

import logging
import os

from . import dynamo
from .config import get_settings

logger = logging.getLogger(__name__)
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))


def resolve_start_audio(event: dict, args: dict) -> bool:
    """라이브 오디오 세션 시작. 스크립트 모드에서는 no-op(False)."""
    if get_settings().is_script:
        logger.info("startAudio no-op (script mode)")
        return False
    logger.info("startAudio callId=%s", args.get("callId"))
    return True


def resolve_audio_chunk(event: dict, args: dict) -> bool:
    """오디오 청크 처리: STT → customer Turn 기록 → AGENT 그래프 1회 실행. 스크립트 모드 no-op.

    라이브 한 턴의 전체 경로(LANGGRAPH-DESIGN §2.1):
      audio chunk → STT(customer_text) → customer Turn write → run_turn(그래프) → 봇 Turn.
    그래프 persist 노드가 봇 Turn/MOT/Compliance를 write하고 Streams가 팬아웃한다.

    STT 브리지는 지연 import (스크립트 모드/단위테스트에서 amazon-transcribe
    미설치여도 모듈 로드 가능). 테스트는 stt 모듈을 monkeypatch한다.
    """
    if get_settings().is_script:
        logger.info("audioChunk no-op (script mode)")
        return False

    call_id = args["callId"]
    data = args["data"]

    text = _stt_chunk_to_text(data)
    if not text:
        return False

    # 다음 seq 계산 후 customer Turn 기록.
    turns = dynamo.query(dynamo.pk_call(call_id), dynamo.SK_PREFIX_TURN)
    seq = len(turns) + 1
    dynamo.put_item({
        "PK": dynamo.pk_call(call_id),
        "SK": dynamo.sk_turn(seq),
        "seq": seq,
        "speaker": "customer",
        "text": text,
    })

    # customer 발화에 대한 봇 응답을 그래프로 생성(best-effort — 실패해도 customer Turn은 남는다).
    _run_agent_turn(call_id, text)
    return True


def _run_agent_turn(call_id: str, customer_text: str) -> None:
    """AGENT 그래프를 1회 실행해 봇 응답 Turn을 생성. 실패는 통화를 끊지 않게 삼킨다.

    그래프 의존성(langgraph 등)은 라이브 모드 전용 — 지연 import로 스크립트/테스트 부담 회피.
    테스트는 agent.runner.run_turn을 monkeypatch하거나, 그래프 미설치 시 graceful no-op.
    """
    try:
        from ..agent.runner import run_turn

        run_turn(call_id, customer_text)
    except Exception:  # noqa: BLE001 — 데모 안정성: 그래프 장애가 customer Turn 기록을 무효화하지 않게
        logger.exception("audioChunk: agent turn failed for call=%s", call_id)


def _stt_chunk_to_text(data_b64: str) -> str:
    """base64 PCM 청크 한 개를 AGENT STT 브리지로 보내 최종 텍스트로 변환.

    STT 구현은 AGENT 소유(stt/transcribe_stt). 단일 청크를 1-item async
    이터레이터로 감싸 stream_chunks → accumulate_final_text 흐름을 돌린다.
    단위 테스트는 transcribe_stt 모듈을 monkeypatch한다.
    """
    import asyncio
    import base64

    from ..stt import transcribe_stt

    audio = base64.b64decode(data_b64) if data_b64 else b""

    async def _one():
        yield audio

    async def _run() -> str:
        results = await transcribe_stt.stream_chunks(_one())
        return await transcribe_stt.accumulate_final_text(results)

    # 전용 이벤트 루프를 새로 만들어 돌리고 닫은 뒤, 프로세스에 "현재 루프"를
    # 하나 남겨둔다. (asyncio.run은 전역 루프를 닫힌 채로 남겨, 동일 프로세스에서
    # get_event_loop()로 기존 루프를 기대하는 코드에 영향을 줄 수 있음.)
    loop = asyncio.new_event_loop()
    try:
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(_run())
    finally:
        loop.close()
        asyncio.set_event_loop(asyncio.new_event_loop())
