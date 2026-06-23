"""Bedrock Converse 래퍼 / LLM router.

AGENT 모듈. SSOT: hk-skills/reference/STACK.md §5(LLM), ARCHITECTURE.md §3.3.

- SDK: langchain-aws ChatBedrockConverse (**Bedrock 전용** — 다른 provider 금지).
- Model: env LLM_MODEL (기본 global.anthropic.claude-haiku-4-5-20251001-v1:0 — 레이턴시 우선).
- 공개 API:
    get_llm()           → ChatBedrockConverse 인스턴스 반환 (이슈 #15 수용 기준).
    classify_turn(...)  → structured output (CLASSIFY_SCHEMA) — nodes.classify
    converse(...)       → 자유 텍스트 생성 (스트리밍) — nodes.respond / compliance._redraft
- 장애 시 LLM_TIMEOUT fallback (API.md §0.3) — 통화 흐름이 끊기지 않게 한국어 기본 문구 반환.
- .astream 인터페이스: ChatBedrockConverse 네이티브 .astream으로 통일.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import AsyncIterator, Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

_DEFAULT_MODEL_ID = "global.anthropic.claude-haiku-4-5-20251001-v1:0"
_REGION = os.environ.get("AWS_REGION", "ap-northeast-2")
_FIRST_TOKEN_TIMEOUT_S = float(os.environ.get("LLM_TIMEOUT_S", "6"))

# LLM 장애 시 통화 흐름 유지용 한국어 기본 문구 (API.md §0.3 fallbackMessage)
FALLBACK_TEXT = "잠시 후 다시 안내해 드리겠습니다."


# ─────────────────────────────────────────────────────────────────────────────
# Structured output 스키마 (nodes.classify)
# ─────────────────────────────────────────────────────────────────────────────


class ClassifyResult(BaseModel):
    """classify 노드의 LLM 구조화 출력. 값은 state.Intent / state.Route 문자열과 일치."""

    intent: str = Field(description="정규화된 고객 의도 (state.Intent 값 중 하나)")
    route: str = Field(description="RESPOND | TRANSFER | CLOSE | SILENCE")
    # 신호 4축 — signals.py 카탈로그 라벨로만 응답(엄격). 카탈로그 밖이면 호출측이 None 폴백.
    emotion: str = Field(default="", description="고객 감정 — signals.Emotion 15종 라벨 중 하나")
    need: str = Field(default="", description="고객 니즈 — signals.Need 15종 라벨 중 하나")
    usability: str = Field(default="", description="이용 가능성 — signals.Usability 20종 라벨 중 하나")
    fraud_suspected: bool = Field(default=False, description="보이스피싱/사기 의심 발화 여부")
    churn_adjust: int = Field(default=0, ge=-10, le=10, description="사전 점수 대비 의미 기반 보정(-10~+10)")
    strategy_tactic: str = Field(default="", description="대응 전략 — signals.Tactic 20종 라벨 중 하나")
    strategy_headline: str = Field(default="", description="전략 헤드라인 한 줄")
    rationale: str = Field(default="", description="판단 근거 한국어 1~2문장")


# ─────────────────────────────────────────────────────────────────────────────
# 클라이언트 (모듈 1회 생성, 콜드스타트 간 재사용)
# ─────────────────────────────────────────────────────────────────────────────

_chat = None


def _client():
    """ChatBedrockConverse 인스턴스 (lazy singleton). 내부 전용."""
    global _chat
    if _chat is None:
        # 지연 import: langchain-aws 미설치 환경(스크립트 모드/유닛테스트)에서도 모듈 로드 가능
        from langchain_aws import ChatBedrockConverse

        # 모델 ID는 클라이언트 생성 시점에 env에서 읽는다(모듈 로드 시점 고정 금지):
        # Lambda 콜드스타트마다 최신 LLM_MODEL을 반영하고, 테스트가 env를 주입할 수 있게 한다.
        model_id = os.environ.get("LLM_MODEL", _DEFAULT_MODEL_ID)
        _chat = ChatBedrockConverse(
            model=model_id,
            region_name=_REGION,
            temperature=0.3,
            max_tokens=512,
        )
    return _chat


def get_llm():
    """ChatBedrockConverse 인스턴스를 반환하는 공개 팩토리 함수.

    이슈 #15 수용 기준:
    - LLM_MODEL 환경변수로 모델 지정 (기본 global.anthropic.claude-haiku-4-5-20251001-v1:0).
    - Bedrock 전용: ChatBedrockConverse 인스턴스 반환.
    - .astream 인터페이스 통일 (ChatBedrockConverse 네이티브 지원).

    Returns:
        ChatBedrockConverse: langchain-aws Bedrock Converse 인스턴스.
    """
    return _client()


# ─────────────────────────────────────────────────────────────────────────────
# 공개 API
# ─────────────────────────────────────────────────────────────────────────────


def classify_turn(system: str, user: str) -> Optional[ClassifyResult]:
    """단일 Converse 호출로 의도/라우팅/감정/전략을 구조화 추출.

    실패 시 None 반환 → 호출측(nodes.classify)이 보수적 기본값(UNCLEAR/RESPOND)으로 폴백.
    """
    try:
        structured = _client().with_structured_output(ClassifyResult)
        return structured.invoke(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ]
        )
    except Exception:  # noqa: BLE001 — 데모 안정성: LLM 장애가 통화를 끊지 않게
        logger.exception("classify_turn failed; falling back to rule-based defaults")
        return None


def converse(system: str, user: str, *, stream: bool = True) -> str:
    """자유 텍스트 응답 생성. 첫 토큰 타임아웃/오류 시 FALLBACK_TEXT 반환.

    Args:
        stream: True면 .stream() 스트리밍(첫 토큰 지연 단축, TTS 파이프라인 친화).
                비동기 스트리밍은 astream_converse() 사용.
    """
    msgs = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    try:
        if stream:
            chunks = [c.content for c in _client().stream(msgs)]
            text = "".join(_as_text(c) for c in chunks).strip()
        else:
            text = _as_text(_client().invoke(msgs).content).strip()
        return text or FALLBACK_TEXT
    except Exception:  # noqa: BLE001
        logger.exception("converse failed; returning fallback text")
        return FALLBACK_TEXT


async def astream_converse(
    system: str,
    user: str,
    *,
    timeout_s: float = _FIRST_TOKEN_TIMEOUT_S,
) -> AsyncIterator[str]:
    """비동기 스트리밍 응답 생성. .astream 인터페이스 통일 (이슈 #15).

    ChatBedrockConverse 네이티브 .astream()을 사용해 청크 단위로 텍스트를 yield.
    첫 토큰 타임아웃 가드: timeout_s 내 첫 청크 미도착 시 FALLBACK_TEXT yield 후 종료.

    Args:
        system: 시스템 프롬프트.
        user: 사용자 발화.
        timeout_s: 첫 토큰 대기 최대 초 (기본 LLM_TIMEOUT_S 환경변수, 6초).

    Yields:
        str: 텍스트 청크.
    """
    msgs = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    try:
        aiter = _client().astream(msgs)
        # 첫 토큰 타임아웃 가드
        try:
            first_chunk = await asyncio.wait_for(aiter.__anext__(), timeout=timeout_s)
        except TimeoutError:
            logger.warning("astream_converse: 첫 토큰 타임아웃 (%.1fs); fallback 반환", timeout_s)
            yield FALLBACK_TEXT
            return
        except StopAsyncIteration:
            yield FALLBACK_TEXT
            return

        text = _as_text(first_chunk.content)
        if text:
            yield text

        async for chunk in aiter:
            chunk_text = _as_text(chunk.content)
            if chunk_text:
                yield chunk_text
    except Exception:  # noqa: BLE001
        logger.exception("astream_converse failed; returning fallback text")
        yield FALLBACK_TEXT


def _as_text(content) -> str:
    """ChatBedrockConverse content(str | list[block])를 평문으로 정규화."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            b.get("text", "") if isinstance(b, dict) else str(b) for b in content
        )
    return str(content)
