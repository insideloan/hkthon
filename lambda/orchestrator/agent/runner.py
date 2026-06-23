"""라이브 턴 러너 / run_turn — 그래프 1회 실행 엔트리.

AGENT 모듈. 설계: docs/agent/LANGGRAPH-DESIGN.md §2.1, §6.

한 nextTurn(또는 audioChunk가 만든 customer Turn) = 그래프 1회 실행이다:
  customer_text → build initial CallState → GRAPH.invoke → persist(노드 내부) → bot Turn 반환.

load_context 노드가 DynamoDB에서 history/customer/stage를 재구성하므로(stateless),
여기서는 call_id + customer_text만 심으면 된다. 반환값은 nextTurn resolver가 쓰는
봇 Turn 투영(dict) — persist가 이미 DynamoDB에 기록했고 Streams가 팬아웃한다.
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))


def run_turn(call_id: str, customer_text: str) -> dict | None:
    """그래프를 1회 실행하고 생성된 봇 Turn 투영을 반환.

    Args:
        call_id: 대상 콜 ID.
        customer_text: 이번 턴 고객 발화(STT 결과 또는 시나리오 텍스트).

    Returns:
        봇 Turn 투영(dict) — {seq, speaker, text, node, churnAfter, flag, tokens}.
        그래프 실행 실패 시 None(통화 흐름 유지 — 호출측이 graceful 처리).
    """
    from .graph import GRAPH

    initial = {"call_id": call_id, "customer_text": customer_text}
    try:
        final = GRAPH.invoke(initial)
    except Exception:  # noqa: BLE001 — 데모 안정성: 그래프 장애가 통화를 끊지 않게
        logger.exception("run_turn graph invoke failed for call=%s", call_id)
        return None

    return _bot_turn_out(final)


def _bot_turn_out(state: dict) -> dict:
    """그래프 최종 state → nextTurn 반환용 봇 Turn 투영(camelCase wire 형상).

    calls.py:_turn_out과 동일 키 규약. persist가 기록한 것과 같은 값.
    """
    seq = state.get("next_seq")
    tokens = [
        {"text": t.get("text"), "polarity": t.get("polarity"), "reason": t.get("reason", "")}
        for t in (state.get("churn_tokens") or [])
    ]
    return {
        "seq": seq,
        "speaker": "bot",
        "text": state.get("bot_text") or state.get("bot_draft") or "",
        "node": _enum_value(state.get("stage")),
        "churnAfter": state.get("churn_after"),
        "flag": _wire_flag(state),
        "tokens": tokens,
    }


def _enum_value(v):
    return v.value if hasattr(v, "value") else v


def _wire_flag(state: dict) -> str:
    """봇 Turn flag → wire TurnFlag enum(RISK|DEF|NEUTRAL). persist의 _turn_flag와 정합."""
    mot = state.get("mot")
    if not mot:
        return "NEUTRAL"
    return "DEF" if mot.get("is_conversion") else "RISK"
