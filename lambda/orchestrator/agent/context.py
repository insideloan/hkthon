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

    # churn_before = 가장 최근에 churn_after가 기록된 Turn 값(봇 Turn만 기록). customer
    # Turn(audioChunk write)은 churn_after가 없으므로 거꾸로 훑어 마지막 점수를 찾는다.
    churn_before = _last_churn(turns)
    next_seq = (int(turns[-1]["seq"]) + 1) if turns else 1
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


def _last_churn(turns: list[dict]) -> int:
    """가장 최근 Turn의 churn_after(없으면 50). customer Turn은 점수가 없어 건너뛴다."""
    for t in reversed(turns):
        val = t.get("churn_after")
        if val is not None:
            return int(val)
    return 50


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
    from ..api import dynamo

    turns = dynamo.query(dynamo.pk_call(call_id), dynamo.SK_PREFIX_TURN)
    # dynamo.query는 SK 사전순(=seq zero-padded 순) 정렬이지만, seq 필드로 한 번 더
    # 안정 정렬해 누락 padding/혼합 데이터에도 결정적 순서를 보장한다.
    turns.sort(key=lambda t: int(t.get("seq", 0)))
    return turns


def _load_customer(call_id: str) -> CustomerCtx:
    """Call META의 customer_id로 CUSTOMER#{id} 로드. 없으면 빈 컨텍스트."""
    from ..api import dynamo

    call = dynamo.get_item(dynamo.pk_call(call_id), dynamo.SK_META) or {}
    customer_id = call.get("customerId")
    if not customer_id:
        return CustomerCtx()
    item = dynamo.get_item(dynamo.pk_cust(customer_id), dynamo.SK_META)
    if not item:
        return CustomerCtx()
    return _to_customer_ctx(item)


def _to_customer_ctx(item: dict) -> CustomerCtx:
    """Customer META 아이템(snake) → CustomerCtx (프롬프트 주입용 투영)."""
    ctx = CustomerCtx(customer_id=item.get("customerId", ""))
    for key in ("name", "target_product", "rate", "limit", "credit_score"):
        if item.get(key) is not None:
            ctx[key] = item[key]
    if item.get("existing_loans") is not None:
        # CustomerCtx.existing_loans는 list[dict](당사/타사) 형상. 시드는 {own,other} 맵을
        # 쓰므로 한 건짜리 요약 dict로 감싼다(프롬프트 표시용 — 정확 스키마는 비강제).
        ctx["existing_loans"] = [dict(item["existing_loans"])]
    if item.get("has_vehicle") is not None:
        ctx["has_vehicle"] = bool(item["has_vehicle"])
    if item.get("persona") is not None:
        ctx["persona_json"] = dict(item["persona"])
    return ctx


def _to_turn_msg(turn: dict) -> TurnMsg:
    return TurnMsg(
        seq=turn["seq"],
        speaker=turn["speaker"],
        text=turn.get("text", ""),
        node=turn.get("node"),
    )
