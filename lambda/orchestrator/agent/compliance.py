"""컴플라이언스 루프 / Bedrock Guardrails review loop.

AGENT 모듈. 설계: docs/agent/LANGGRAPH-DESIGN.md §4.7, ARCHITECTURE.md §3.3.

draft → Guardrails.apply → (blocked면 redraft, try<2) → approved.
각 전이는 ComplianceStep으로 적재 → persist가 ComplianceReview write → onComplianceState.
금소법: 부당권유(재설득)·확정수치·중요사항 누락·제3자 정보노출 차단.
"""

from __future__ import annotations

from . import prompts
from ..llm import router
from .state import CallState, ComplianceStep, Stage

_MAX_RETRIES = 2


def review_loop(draft: str, state: CallState) -> tuple[list[ComplianceStep], str]:
    """Guardrails 루프 실행 → (단계 로그, 최종 승인 텍스트).

    Returns:
        (compliance_log, approved_text)
    """
    log: list[ComplianceStep] = []
    current = draft

    log.append(_step("drafting", current, None, [], 0))

    for attempt in range(_MAX_RETRIES + 1):
        verdict = _apply_guardrails(current)  # TODO: Bedrock Guardrails.apply()
        log.append(_step("reviewing", current, verdict.get("action"), verdict.get("violated", []), attempt))

        if not verdict.get("blocked"):
            log.append(_step("approved", current, "approved", [], attempt))
            return log, current

        if attempt >= _MAX_RETRIES:
            break

        # 위반 → 텍스트 삭제 연출 후 회피 지시로 재생성
        log.append(_step("redacting", current, "blocked", verdict.get("violated", []), attempt))
        current = _redraft(state, current, verdict)  # TODO: router.converse(prompt + 회피지시)
        log.append(_step("redrafting", current, None, [], attempt + 1))

    # 재시도 소진 → 안전한 fallback 멘트로 승인 (통화 흐름 유지, API.md §0.3)
    fallback = "정확한 내용은 상담원이 다시 안내해 드리겠습니다."
    log.append(_step("approved", fallback, "approved_fallback", [], _MAX_RETRIES))
    return log, fallback


def _apply_guardrails(text: str) -> dict:
    """Bedrock Guardrails 적용 → {blocked, violated[], action}."""
    # TODO: bedrock guardrails apply. 데모 스크립트 모드는 사전 시나리오 재생.
    return {"blocked": False, "violated": [], "action": "approved"}


def _redraft(state: CallState, blocked_text: str, verdict: dict) -> str:
    """위반 지적을 반영해 회피 지시와 함께 재생성."""
    system = prompts.redraft_system(verdict.get("violated", []))
    stage_guide = prompts.STAGE_GUIDE.get(state.get("stage", Stage.IDENTIFY), "")
    user = f"{stage_guide}\n\n[직전(차단된) 응답]\n{blocked_text}\n\n위 응답을 정책에 맞게 다시 작성하세요."
    return router.converse(system, user, stream=False)


def _step(state_name, draft, verdict, violated, try_no) -> ComplianceStep:
    return ComplianceStep(
        state=state_name,
        draft=draft,
        verdict=verdict,
        violated_policies=violated,
        try_no=try_no,
    )
