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
    """classify 노드의 LLM 구조화 출력. 값은 state.Intent / state.Route 문자열과 일치.

    레이턴시 주의: 이 스키마의 Field 설명은 매 classify 호출의 입력 토큰으로 주입되고
    (with_structured_output가 tool schema로 변환), rationale 길이는 출력 토큰을 좌우한다.
    라벨 카탈로그의 권위 소스는 prompts._signal_catalog(시스템 프롬프트)이므로, 여기 설명은
    카탈로그를 중복 나열하지 않고 짧게 유지한다(입력 토큰 ↓ → 라이브 한 턴 레이턴시 ↓).
    """

    intent: str = Field(description="state.Intent 값")
    route: str = Field(description="RESPOND|TRANSFER|CLOSE|SILENCE")
    # 신호 4축 — signals.py 카탈로그 라벨로만 응답(엄격). 카탈로그 밖이면 호출측이 None 폴백.
    # 허용 라벨 목록은 시스템 프롬프트(_signal_catalog)에 있으므로 여기선 축 이름만.
    emotion: str = Field(default="", description="감정 라벨")
    need: str = Field(default="", description="니즈 라벨")
    usability: str = Field(default="", description="이용가능성 라벨")
    fraud_suspected: bool = Field(default=False, description="보이스피싱/사기 의심 여부")
    churn_adjust: int = Field(default=0, ge=-10, le=10, description="사전 점수 보정(-10~+10)")
    strategy_tactic: str = Field(default="", description="전략 라벨")
    strategy_headline: str = Field(default="", description="전략 카드 제목 한 줄")
    # rationale은 관리자 화면 표시용(짧게). 길면 출력 토큰만 늘어 레이턴시 악화.
    rationale: str = Field(default="", description="판단 근거 한국어 한 문장(최대 40자)")


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
        # 라이브 통화 레이턴시 우선 — reasoning(extended thinking) 비활성.
        # Bedrock Converse에서 Claude의 thinking은 additionalModelRequestFields에
        # thinking 블록을 "넣어야" 켜지는 opt-in이다(langchain_aws _is_thinking_enabled:
        # type=="enabled"일 때만 활성). 따라서 그 필드를 주지 않으면 thinking은
        # 애초에 일어나지 않는다 — 굳이 {"type":"disabled"} 같은 비표준 키를 보내면
        # Bedrock이 400을 낼 수 있으므로 보내지 않는다.
        # (라이브 한 턴의 ~20s는 thinking이 아니라 classify+respond(+compliance)
        #  직렬 Bedrock 호출 때문 — max_tokens 512로 출력 토큰을 짧게 묶어 단축.)
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


def converse(system: str, user: str, *, stream: bool = False) -> str:
    """자유 텍스트 응답 생성(완성된 전체 문자열). 오류 시 FALLBACK_TEXT 반환.

    동기 converse는 전체 응답이 모인 뒤에야 반환한다(respond→compliance가 완성 draft를
    필요로 하고, persist/팬아웃도 완성 후에 일어남). 따라서 .stream()으로 청크를 모아
    join하던 과거 구현은 .invoke()와 결과가 동일하면서 청크 오버헤드만 더했다 —
    .invoke()로 통일한다. 토큰 단위 점진 전달이 필요한 경로는 astream_converse()를 쓴다.

    Args:
        stream: 하위호환용 인자(무시됨). 점진 스트리밍은 astream_converse() 사용.
    """
    msgs = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    try:
        text = _as_text(_client().invoke(msgs).content).strip()
        return text or FALLBACK_TEXT
    except Exception:  # noqa: BLE001
        logger.exception("converse failed; returning fallback text")
        return FALLBACK_TEXT


def classify_and_respond_concurrent(
    classify_system: str,
    respond_system: str,
    history: str,
) -> tuple[Optional[ClassifyResult], str]:
    """classify와 (전략 미주입) blind respond를 동시 실행해 직렬 지연을 줄인다.

    두 호출은 서로 의존이 없으므로 스레드 풀로 병렬화한다(라이브 한 턴에서 respond
    지연 ~1.6-2.3s를 classify 지연 뒤로 숨김). respond는 tactic/emotion 스티어링 없이
    생성되므로(_strategy_block 빈 블록), route가 RESPOND일 때만 쓰고 그 외(TRANSFER/
    CLOSE/SILENCE)면 호출측이 폐기한다.

    Returns:
        (ClassifyResult | None, blind_draft). classify 실패 시 (None, draft),
        respond 실패 시 (result, FALLBACK_TEXT).
    """
    from concurrent.futures import ThreadPoolExecutor

    def _classify() -> Optional[ClassifyResult]:
        return classify_turn(classify_system, history)

    def _respond() -> str:
        return converse(respond_system, history, stream=False)

    with ThreadPoolExecutor(max_workers=2) as ex:
        f_classify = ex.submit(_classify)
        f_respond = ex.submit(_respond)
        return f_classify.result(), f_respond.result()


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
