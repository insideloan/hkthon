"""컴플라이언스 루프 / Bedrock Guardrails review loop.

AGENT 모듈. 설계: docs/agent/LANGGRAPH-DESIGN.md §4.7, ARCHITECTURE.md §3.3.

draft → Guardrails.apply → (blocked면 redraft, try<2) → approved.
각 전이는 ComplianceStep으로 적재 → persist가 ComplianceReview write → onComplianceState.
금소법: 부당권유(재설득)·확정수치·중요사항 누락·제3자 정보노출 차단.
"""

from __future__ import annotations

import logging
import os
import re

from . import prompts
from ..llm import router
from .state import CallState, ComplianceStep, Stage

logger = logging.getLogger(__name__)

_MAX_RETRIES = 2

# 라이브 모드에서 Bedrock Guardrails 식별자 (설정 시 실호출, 없으면 룰 폴백)
_GUARDRAIL_ID = os.environ.get("BEDROCK_GUARDRAIL_ID")
_GUARDRAIL_VERSION = os.environ.get("BEDROCK_GUARDRAIL_VERSION", "DRAFT")
_REGION = os.environ.get("AWS_REGION", "ap-northeast-2")

# bedrock-runtime 클라이언트 (모듈 1회 생성, 콜드스타트 간 재사용)
_bedrock = None


def _bedrock_client():
    """bedrock-runtime 클라이언트 (lazy singleton). boto3 미설치/미설정 환경에선 호출 안 됨."""
    global _bedrock
    if _bedrock is None:
        import boto3  # 지연 import: 유닛테스트(boto3 없이 룰만)에서도 모듈 로드 가능

        _bedrock = boto3.client("bedrock-runtime", region_name=_REGION)
    return _bedrock

# ─────────────────────────────────────────────────────────────────────────────
# 룰 기반 폴백 검수 — 금소법 위반 패턴 (CHURN-RISK-LEXICON/xlsx 금지사항 기반)
# Bedrock Guardrails 미구성 환경(데모 스크립트/유닛테스트)에서도 결정적으로 동작.
# ─────────────────────────────────────────────────────────────────────────────

# 1) 확정·약속 단정 (금소법 부당권유) — 수치/가능여부 단정
_POLICY_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("CONFIRM_PROMISE", re.compile(r"무조건|반드시\s*됩니다|제가\s*해드릴|확정(?:이|입니다|해)|보장(?:해|합니다|됩니다)")),
    # 2) 확정 수치 (예시/가정·심사 단서 없이 단정한 금리/한도/절감액)
    ("FIXED_FIGURE", re.compile(r"(?:금리|한도|절감액|월\s*\d)\D{0,6}\d")),
    # 3) 금리 불변 단정 ('오릅니다' 등 ㄹ불규칙 활용 포함)
    (
        "RATE_NEVER_RISES",
        re.compile(
            r"금리[가는]?\s*(?:절대|전혀)?\s*(?:안|않)\s*(?:오르|오릅|올라|올랐|올릴|상승|인상)"
            r"|금리[가는]?\s*(?:절대|전혀)\s*\S*\s*(?:오르|오릅|올라|상승|인상)"
        ),
    ),
    # 4) 리스크 무마 (연체/담보 불이익 부정)
    ("RISK_DOWNPLAY", re.compile(r"그럴\s*일\s*없|불이익\s*없|문제\s*(?:가)?\s*전혀\s*없|걱정\s*안\s*하셔도")),
]
# 확정 수치라도 예시/가정·심사 단서가 함께 있으면 위반 아님 (공통요건 §2 충족)
_FIGURE_SAFE = re.compile(r"예시|가정|심사\s*(?:결과|후|를\s*거)|달라질\s*수|예상")


def review_loop(draft: str, state: CallState) -> tuple[list[ComplianceStep], str]:
    """Guardrails 루프 실행 → (단계 로그, 최종 승인 텍스트).

    Returns:
        (compliance_log, approved_text)
    """
    log: list[ComplianceStep] = []
    original = draft  # FRONTEND diff(cmpFinal)용 원문 — 재작성돼도 보존
    current = draft

    log.append(_step("drafting", current, None, [], 0))

    for attempt in range(_MAX_RETRIES + 1):
        verdict = _apply_guardrails(current)
        log.append(_step("reviewing", current, verdict.get("action"), verdict.get("violated", []), attempt))

        if not verdict.get("blocked"):
            # approved 단계는 원문(draft)과 최종문(final_text)을 함께 실어 FRONTEND diff 지원
            log.append(_step("approved", original, "approved", [], attempt, final_text=current))
            return log, current

        if attempt >= _MAX_RETRIES:
            break

        # 위반 → 텍스트 삭제 연출 후 회피 지시로 재생성
        log.append(_step("redacting", current, "blocked", verdict.get("violated", []), attempt))
        current = _redraft(state, current, verdict)
        log.append(_step("redrafting", current, None, [], attempt + 1))

    # 재시도 소진 → 안전한 fallback 멘트로 승인 (통화 흐름 유지, API.md §0.3)
    fallback = "정확한 내용은 상담원이 다시 안내해 드리겠습니다."
    log.append(_step("approved", original, "approved_fallback", [], _MAX_RETRIES, final_text=fallback))
    return log, fallback


def _apply_guardrails(text: str) -> dict:
    """검수 → {blocked, violated[], action}.

    BEDROCK_GUARDRAIL_ID 설정 시 Bedrock Guardrails 실호출, 아니면 룰 기반 폴백.
    """
    if _GUARDRAIL_ID:
        bedrock = _bedrock_guardrails(text)
        if bedrock is not None:
            return bedrock
    return _rule_guardrails(text)


def _rule_guardrails(text: str) -> dict:
    """금소법 위반 패턴 룰 검수 (결정적 폴백)."""
    violated: list[str] = []
    for policy, pat in _POLICY_PATTERNS:
        if not pat.search(text):
            continue
        # 수치 단정은 예시/가정·심사 단서가 있으면 면제
        if policy == "FIXED_FIGURE" and _FIGURE_SAFE.search(text):
            continue
        violated.append(policy)
    blocked = bool(violated)
    return {"blocked": blocked, "violated": violated, "action": "blocked" if blocked else "approved"}


def _bedrock_guardrails(text: str) -> dict | None:
    """Bedrock Guardrails ApplyGuardrail 실호출. 오류 시 None → 룰 폴백.

    응답의 `action == "GUARDRAIL_INTERVENED"`이면 차단으로 보고, `assessments`에서
    위반 정책명을 추출한다. 데모 안정성: 어떤 예외든 None을 돌려 룰 검수로 폴백한다.
    """
    try:
        resp = _bedrock_client().apply_guardrail(
            guardrailIdentifier=_GUARDRAIL_ID,
            guardrailVersion=_GUARDRAIL_VERSION,
            source="OUTPUT",
            content=[{"text": {"text": text}}],
        )
    except Exception:  # noqa: BLE001 — LLM/네트워크 장애가 통화를 끊지 않게 룰 폴백
        logger.exception("apply_guardrail failed; falling back to rule guardrails")
        return None

    blocked = resp.get("action") == "GUARDRAIL_INTERVENED"
    violated = _extract_violated(resp.get("assessments", []))
    return {
        "blocked": blocked,
        "violated": violated,
        "action": "blocked" if blocked else "approved",
    }


def _extract_violated(assessments: list) -> list[str]:
    """ApplyGuardrail assessments → 위반 정책명 목록.

    Bedrock 응답의 각 policy 유형(topic/content/word/sensitiveInformation)에서
    차단(action=BLOCKED/ANONYMIZED)된 항목의 식별자만 모은다. 응답 형태가 달라도
    방어적으로 파싱(키 누락 시 건너뜀)한다.
    """
    violated: list[str] = []
    for a in assessments:
        for topic in a.get("topicPolicy", {}).get("topics", []):
            if topic.get("action") == "BLOCKED":
                violated.append(topic.get("name", "TOPIC"))
        for filt in a.get("contentPolicy", {}).get("filters", []):
            if filt.get("action") == "BLOCKED":
                violated.append(filt.get("type", "CONTENT"))
        for word in a.get("wordPolicy", {}).get("customWords", []):
            if word.get("action") == "BLOCKED":
                violated.append(word.get("match", "WORD"))
        si = a.get("sensitiveInformationPolicy", {})
        for pii in si.get("piiEntities", []):
            if pii.get("action") in ("BLOCKED", "ANONYMIZED"):
                violated.append(pii.get("type", "PII"))
    return violated


def _redraft(state: CallState, blocked_text: str, verdict: dict) -> str:
    """위반 지적을 반영해 회피 지시와 함께 재생성."""
    system = prompts.redraft_system(verdict.get("violated", []))
    stage_guide = prompts.STAGE_GUIDE.get(state.get("stage", Stage.IDENTIFY), "")
    user = f"{stage_guide}\n\n[직전(차단된) 응답]\n{blocked_text}\n\n위 응답을 정책에 맞게 다시 작성하세요."
    return router.converse(system, user, stream=False)


def _step(state_name, draft, verdict, violated, try_no, *, final_text=None) -> ComplianceStep:
    return ComplianceStep(
        state=state_name,
        draft=draft,
        verdict=verdict,
        violated_policies=violated,
        try_no=try_no,
        final_text=final_text,
    )
