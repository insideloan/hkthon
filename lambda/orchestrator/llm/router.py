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
import json
import logging
import os
import re
from typing import AsyncIterator, Optional

from pydantic import BaseModel, Field, ValidationError

logger = logging.getLogger(__name__)

_DEFAULT_MODEL_ID = "global.anthropic.claude-haiku-4-5-20251001-v1:0"
_REGION = os.environ.get("AWS_REGION", "ap-northeast-2")
_FIRST_TOKEN_TIMEOUT_S = float(os.environ.get("LLM_TIMEOUT_S", "6"))

# classify 출력 방식 게이트 — 기본 ON(prompted JSON):
#   "1"(기본) → with_structured_output(Bedrock tool-use 강제) 대신 프롬프트로 JSON 출력을
#               지시하고 .invoke() 자유 텍스트를 _parse_classify로 검증/파싱.
#   "0"        → 기존 with_structured_output(tool-use) 경로(폴백/대조용).
# tool-use 강제는 입력에 tool 스키마를 주입하고 제약 디코딩을 유발해 classify를 느리게 했다.
# JSON 모드는 그 오버헤드를 제거하되 _parse_classify + nodes.classify 폴백으로 정합성 유지.
_CLASSIFY_JSON_MODE = os.environ.get("CLASSIFY_JSON_MODE", "1") == "1"

# LLM 장애 시 통화 흐름 유지용 한국어 기본 문구 (API.md §0.3 fallbackMessage)
FALLBACK_TEXT = "잠시 후 다시 안내해 드리겠습니다."


# ─────────────────────────────────────────────────────────────────────────────
# Structured output 스키마 (nodes.classify)
# ─────────────────────────────────────────────────────────────────────────────


class ClassifyResult(BaseModel):
    """classify 노드의 LLM 구조화 출력. 값은 state.Intent / state.Route 문자열과 일치.

    레이턴시 주의: rationale 길이는 출력 토큰을 좌우한다(짧게 유지). 라벨 카탈로그의 권위
    소스는 prompts._signal_catalog(시스템 프롬프트)이므로, 여기 Field 설명은 카탈로그를
    중복 나열하지 않고 짧게 유지한다.
    기본 경로(CLASSIFY_JSON_MODE=1)는 이 모델을 _parse_classify로 검증하는 데만 쓰고,
    구 경로(=0)는 with_structured_output이 이 스키마를 tool schema로 변환해 입력에 주입한다.
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


# CLASSIFY_JSON_MODE=1에서 시스템 프롬프트 끝에 덧붙이는 출력 형식 지시.
# tool-use 강제 없이 모델이 "오직 JSON 객체 하나"만 내도록 유도한다(코드펜스/설명 금지).
# 키·허용값 설명은 시스템 프롬프트 본문(_signal_catalog 등)이 권위 소스이므로 여기선 형태만 못박는다.
_JSON_INSTRUCTION = (
    "\n\n[출력 형식 — 엄수]\n"
    "위 분석 결과를 아래 키를 가진 JSON 객체 **하나만** 출력하세요. "
    "코드펜스(```), 주석, 설명 문장을 절대 덧붙이지 말고 `{`로 시작해 `}`로 끝내세요.\n"
    '{"intent": "...", "route": "RESPOND|TRANSFER|CLOSE|SILENCE", '
    '"emotion": "", "need": "", "usability": "", '
    '"fraud_suspected": false, "churn_adjust": 0, '
    '"strategy_tactic": "", "strategy_headline": "", "rationale": ""}\n'
    "emotion/need/usability/strategy_tactic은 위 신호 카탈로그 라벨 중 하나(미상이면 빈 문자열), "
    "churn_adjust는 -10~10 정수, fraud_suspected는 boolean입니다."
)


def _parse_classify(text: str) -> Optional[ClassifyResult]:
    """JSON 모드 LLM 자유텍스트 응답을 ClassifyResult로 견고 파싱.

    모델이 코드펜스나 앞뒤 설명을 덧붙여도 첫 `{`~마지막 `}` 구간만 떼어 json.loads한다.
    어느 단계든 실패하면 None을 반환해 호출측(nodes.classify)이 규칙 기반 기본값으로 폴백한다.
    """
    if not text:
        return None
    # ```json ... ``` 펜스 제거 후, 가장 바깥 중괄호 구간만 슬라이스.
    stripped = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    start, end = stripped.find("{"), stripped.rfind("}")
    if start == -1 or end == -1 or end < start:
        logger.warning("classify JSON 모드: 응답에서 JSON 객체를 찾지 못함")
        return None
    try:
        data = json.loads(stripped[start : end + 1])
    except (json.JSONDecodeError, ValueError):
        logger.warning("classify JSON 모드: json.loads 실패")
        return None
    if not isinstance(data, dict):
        return None
    try:
        return ClassifyResult.model_validate(data)
    except ValidationError:
        logger.warning("classify JSON 모드: 스키마 검증 실패")
        return None


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

    CLASSIFY_JSON_MODE=1(기본): 프롬프트로 JSON 출력을 지시하고 .invoke() 자유 텍스트를
    _parse_classify로 검증/파싱(tool-use 강제 제거 → 입력 토큰·제약 디코딩 오버헤드 감소).
    CLASSIFY_JSON_MODE=0: 기존 with_structured_output(Bedrock tool-use) 경로.
    어느 경로든 실패 시 None 반환 → 호출측(nodes.classify)이 보수적 기본값(UNCLEAR/RESPOND)으로 폴백.
    """
    try:
        if _CLASSIFY_JSON_MODE:
            raw = _client().invoke(
                [
                    {"role": "system", "content": system + _JSON_INSTRUCTION},
                    {"role": "user", "content": user},
                ]
            )
            return _parse_classify(_as_text(raw.content))
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
