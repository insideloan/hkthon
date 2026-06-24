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
    """라이브 오디오 세션 시작. 스크립트 모드에서는 no-op(False).

    세션 시작 시점에 무거운 콜드 의존성(DynamoDB 리소스, AWS Transcribe 클라이언트
    임포트)을 미리 초기화해 둔다. 그러지 않으면 첫 audioChunk가 이 비용을 전부
    떠안아 사용자의 "첫 발화 → 텍스트" 지연이 유독 길어진다. prewarm은 best-effort —
    실패해도 세션 시작을 막지 않는다(첫 청크에서 자연스럽게 재시도).
    """
    if get_settings().is_script:
        logger.info("startAudio no-op (script mode)")
        return False
    logger.info("startAudio callId=%s", args.get("callId"))
    _prewarm()
    return True


def _prewarm() -> None:
    """첫 발화 지연을 줄이기 위해 콜드 의존성을 미리 초기화(best-effort)."""
    try:
        dynamo.get_table()  # boto3 dynamodb resource lazy 생성을 당겨서 치름.
    except Exception:  # noqa: BLE001 — prewarm 실패는 세션을 막지 않는다.
        logger.debug("startAudio prewarm: dynamo 초기화 스킵", exc_info=True)
    try:
        # amazon-transcribe 패키지 임포트(콜드에서 수백 ms) + 클라이언트 생성 비용을
        # 첫 청크 전에 당겨둔다. 스트림은 첫 audioChunk에서 연다.
        from ..stt import transcribe_stt  # noqa: PLC0415

        transcribe_stt.prewarm()
    except Exception:  # noqa: BLE001
        logger.debug("startAudio prewarm: STT 초기화 스킵", exc_info=True)


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
    # STT가 빈 문자열 또는 구두점·공백뿐인 잡음(예: ".")을 돌려주면 customer Turn도
    # 만들지 않고 그래프(classify 2.5-4s)도 트리거하지 않는다 — 연속 오디오 스트림에서
    # 무의미 청크가 매번 전체 그래프를 돌려 응답이 폭주하던 문제를 막는다.
    # (단 "네"·"음" 같은 실제 최소 응답은 의미 글자가 있으므로 통과 → silence 노드가 처리.)
    if not _has_speech(text):
        logger.info("audioChunk: STT 무음/잡음 스킵 call=%s text=%r", call_id, text)
        return False

    # 에코 안전망: 모바일은 스피커-마이크가 가까워 봇 음성이 마이크로 되먹임된다.
    # 프론트 AEC·VAD 게이팅이 다 못 막은 잔여가 STT까지 흘러 "봇이 방금 한 말"이
    # 유령 customer Turn으로 기록되면, 그래프가 자기 발화에 또 응답해 루프가 돈다.
    # 직전 봇 발화와 STT 결과가 충분히 유사하면 에코로 보고 드롭한다.
    if _looks_like_bot_echo(call_id, text):
        logger.info("audioChunk: 봇 에코 의심 드롭 call=%s text=%r", call_id, text)
        return False

    # 다음 seq 계산 후 customer Turn 기록. 동시 audioChunk(연속 오디오 스트림에서
    # 발화가 빠르게 이어지거나, barge-in 되먹임 등)가 같은 seq를 중복 발급하면 TTS
    # S3 키가 충돌하고 프론트가 멱등 차단으로 음성을 버린다 — len(turns)+1 대신
    # max(seq)+1을 쓰고, attribute_not_exists 조건부 write로 충돌 시 재계산·재시도한다.
    seq = _write_customer_turn(call_id, text)
    if seq is None:
        logger.warning("audioChunk: customer Turn write 충돌 재시도 소진 call=%s", call_id)
        return False

    # customer 발화에 대한 봇 응답을 그래프로 생성(best-effort — 실패해도 customer Turn은 남는다).
    _run_agent_turn(call_id, text)
    return True


# 동시 write 충돌 시 seq 재계산 재시도 횟수(데모 규모에선 충돌이 드물어 소수로 충분).
_SEQ_RETRY = 5


def _write_customer_turn(call_id: str, text: str) -> int | None:
    """customer Turn을 충돌 없는 seq로 조건부 write하고 그 seq를 반환. 소진 시 None.

    seq = 기존 Turn 최대 seq + 1. 조건부 write가 실패(다른 invocation이 선점)하면
    Turn을 다시 조회해 seq를 올려 재시도한다.
    """
    for _ in range(_SEQ_RETRY):
        turns = dynamo.query(dynamo.pk_call(call_id), dynamo.SK_PREFIX_TURN)
        seq = max((int(t.get("seq", 0)) for t in turns), default=0) + 1
        try:
            dynamo.put_item_if_absent({
                "PK": dynamo.pk_call(call_id),
                "SK": dynamo.sk_turn(seq),
                "seq": seq,
                "speaker": "customer",
                "text": text,
            })
            return seq
        except dynamo.ConditionalCheckFailedError:
            logger.info("audioChunk: seq=%s 선점됨, 재계산 재시도 call=%s", seq, call_id)
            continue
    return None


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


# 직전 봇 발화와 STT 결과의 토큰 자카드 유사도가 이 값 이상이면 에코로 간주.
# 0.6은 데모 발화 길이에서 "사실상 같은 문장"을 잡되, 고객이 봇 말을 일부 따라하는
# 정상 응답(예: 봇 질문 키워드 일부 반복)은 통과시키는 절충값.
_ECHO_SIMILARITY_THRESHOLD = 0.6


def _normalize_tokens(text: str) -> set[str]:
    """비교용 토큰 집합 — 소문자화 후 한/영/숫자 토큰만 추출(구두점·공백 무시)."""
    import re

    return set(re.findall(r"[0-9a-z가-힣]+", text.lower()))


def _looks_like_bot_echo(call_id: str, text: str) -> bool:
    """STT 결과가 직전 봇 발화의 되먹임(에코)으로 의심되는지.

    가장 최근 bot Turn 텍스트와 토큰 자카드 유사도를 재 임계값 이상이면 True.
    조회 실패·봇 발화 없음·짧은 텍스트는 보수적으로 False(정상 발화를 막지 않는다).
    """
    cand = _normalize_tokens(text)
    if not cand:
        return False
    try:
        turns = dynamo.query(dynamo.pk_call(call_id), dynamo.SK_PREFIX_TURN)
    except Exception:  # noqa: BLE001 — 조회 실패 시 필터를 끄고 정상 경로로.
        logger.debug("echo 필터: Turn 조회 실패 call=%s", call_id, exc_info=True)
        return False
    bot_turns = [t for t in turns if t.get("speaker") == "bot" and t.get("text")]
    if not bot_turns:
        return False
    last_bot = max(bot_turns, key=lambda t: int(t.get("seq", 0)))
    ref = _normalize_tokens(str(last_bot.get("text", "")))
    if not ref:
        return False
    overlap = len(cand & ref)
    union = len(cand | ref)
    similarity = overlap / union if union else 0.0
    return similarity >= _ECHO_SIMILARITY_THRESHOLD


def _has_speech(text: str) -> bool:
    """STT 결과에 의미 있는 발화 글자가 있는지 — 구두점·공백뿐이면 False.

    한글/영문/숫자가 하나라도 있으면 발화로 본다(예: "네", "음", "여보세요").
    ".", " ", "...", "?" 등 잡음/구두점만 있으면 무음으로 간주해 그래프를 트리거하지 않는다.
    """
    import re

    return bool(text and re.search(r"[0-9A-Za-z가-힣]", text))


def _stt_chunk_to_text(data_b64: str) -> str:
    """base64 PCM 청크 한 개를 AGENT STT 브리지로 보내 최종 텍스트로 변환.

    STT 구현은 AGENT 소유(stt/transcribe_stt). 단일 청크를 1-item async
    이터레이터로 감싸 stream_chunks → best_effort_text 흐름을 돌린다
    (최종 우선, 없으면 최신 partial 폴백).
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
        # 최종이 있으면 최종, 없으면 최신 partial로 폴백 — 발화 끝~표시 지연을 줄이고,
        # 짧은 발화에서 final 미확정으로 customer Turn이 통째로 드롭되던 문제를 막는다.
        return await transcribe_stt.best_effort_text(results)

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
