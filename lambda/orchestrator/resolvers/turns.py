"""nextTurn 뮤테이션 resolver (BACKEND — 라이브 파이프라인 글루).

라이브 모드: customer 발화(이미 audioChunk가 Turn으로 기록했거나, 인자로 전달)에 대해
AGENT 그래프를 1회 실행해 봇 응답 Turn을 생성한다(agent.runner.run_turn에 위임).
스크립트 모드(ORCHESTRATOR_MODE=script): scenario.json 재생이 SSOT이므로 그래프를
타지 않는다 — 다음 시나리오 Turn을 그대로 방송(별도 시나리오 러너 소유)하거나 no-op.

반환: 생성된 봇 Turn(graphql Turn) 또는 null. 실제 영속화/팬아웃은 그래프 persist 노드가
DynamoDB write → Streams로 처리하므로, 이 resolver는 동기 응답값만 마샬링한다.
"""

from __future__ import annotations

import logging
import os

from ..api import dynamo
from ..api.config import get_settings
from ..handler import OrchestratorError

logger = logging.getLogger(__name__)
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))


def resolve_next_turn(event: dict, args: dict) -> dict | None:
    """nextTurn(callId, customerText?) → 봇 Turn 또는 null.

    customerText 미전달(라이브 오디오 경로) 시, 마지막 customer Turn의 텍스트를
    이번 발화로 사용한다(audioChunk가 직전에 기록). customer 발화가 없으면 no-op(null).
    """
    call_id = args["callId"]
    _require_call(call_id)

    customer_text = args.get("customerText") or _last_customer_text(call_id)
    if not customer_text:
        logger.info("nextTurn no-op: no customer utterance for call=%s", call_id)
        return None

    if get_settings().is_script:
        # 스크립트 모드는 그래프를 타지 않는다(시나리오 재생이 SSOT). 글루 레이어에서는 no-op.
        logger.info("nextTurn no-op (script mode) call=%s", call_id)
        return None

    from ..agent.runner import run_turn

    return run_turn(call_id, customer_text)


def _require_call(call_id: str) -> dict:
    item = dynamo.get_item(dynamo.pk_call(call_id), dynamo.SK_META)
    if not item:
        raise OrchestratorError("NOT_FOUND", f"call not found: {call_id}")
    return item


def _last_customer_text(call_id: str) -> str:
    """가장 최근 customer Turn의 텍스트(없으면 빈 문자열)."""
    turns = dynamo.query(dynamo.pk_call(call_id), dynamo.SK_PREFIX_TURN)
    for t in sorted(turns, key=lambda x: int(x.get("seq", 0)), reverse=True):
        if t.get("speaker") == "customer" and (t.get("text") or "").strip():
            return t["text"]
    return ""
