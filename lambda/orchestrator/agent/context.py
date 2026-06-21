"""DynamoDB → CallState 재구성 / Stateless context rebuild.

AGENT 모듈 (신규 — docs/MODULES.md / ARCHITECTURE.md §5 파일맵에 추가 필요).
설계: docs/agent/LANGGRAPH-DESIGN.md §6.

Lambda는 stateless이며 LangGraph checkpointer를 쓰지 않는다. 매 nextTurn마다
해당 call의 Turn 이력을 DynamoDB에서 읽어 CallState를 재구성한다.
"""

from __future__ import annotations

from .state import CallState, CustomerCtx, Stage, TurnMsg

# 프롬프트 토큰 절약: 최근 N턴만 history로 전달
_HISTORY_WINDOW = 12


def load_call_state(call_id: str, customer_text: str) -> CallState:
    """call_id의 Turn 이력을 읽어 CallState를 재구성 (LANGGRAPH-DESIGN §6)."""
    turns = _query_turns(call_id)              # TODO: Query PK=CALL#{id}, SK begins_with TURN#
    customer = _load_customer(call_id)         # TODO: META.customer_id → CUSTOMER#{id}

    churn_before = turns[-1]["churn_after"] if turns else 50
    next_seq = (turns[-1]["seq"] + 1) if turns else 1
    history: list[TurnMsg] = [_to_turn_msg(t) for t in turns[-_HISTORY_WINDOW:]]

    return CallState(
        call_id=call_id,
        customer=customer,
        stage=_infer_stage(turns),
        history=history,
        customer_text=customer_text,
        churn_before=churn_before,
        next_seq=next_seq,
    )


def _infer_stage(turns: list[dict]) -> Stage:
    """마지막 봇 Turn의 node/단계 마커에서 현재 stage 추론. 없으면 IDENTIFY부터."""
    for t in reversed(turns):
        node = t.get("node")
        if node in Stage.__members__:
            return Stage[node]
        # node가 stage 값 문자열로 저장된 경우
        try:
            return Stage(node)
        except (ValueError, TypeError):
            continue
    return Stage.IDENTIFY


# ─────────────────────────────────────────────────────────────────────────────
# DynamoDB 접근 (models 모듈 위임 — DATA 소유 키 설계 사용)
# ─────────────────────────────────────────────────────────────────────────────


def _query_turns(call_id: str) -> list[dict]:
    """CALL#{id}의 TURN#* 아이템을 seq 순으로 반환."""
    # TODO: models.turns.list_by_call(call_id) — DATA 모듈 키 설계 사용
    return []


def _load_customer(call_id: str) -> CustomerCtx:
    """Call META의 customer_id로 CUSTOMER#{id} 로드."""
    # TODO: models.calls.get(call_id).customer_id → models.customers.get(...)
    return CustomerCtx()


def _to_turn_msg(turn: dict) -> TurnMsg:
    return TurnMsg(
        seq=turn["seq"],
        speaker=turn["speaker"],
        text=turn.get("text", ""),
        node=turn.get("node"),
    )
