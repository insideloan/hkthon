"""Call resolvers (BACKEND #23/#24/#25).

- createCall(customerId)            : 분석 전용 콜 생성 (발신 아님)
- dialCall(customerId)              : 통화 버튼 발신 → state=DIALING
- call(id)                          : 모니터링 스냅샷 (CallSnapshot)
- approveProduct / transferToAgent / sendLink / endCall : 콜 액션 4종

행 클릭은 모니터링 진입일 뿐 자동 발신하지 않는다 — 발신은 명시적 dialCall 뿐.
스키마 변경은 graphql/schema.graphql (BACKEND 소유).
"""

from __future__ import annotations

from ..api import dynamo
from ..handler import OrchestratorError
from ._common import ACTIVE_STATES, new_call_id, now_iso

# ─────────────────────────────────────────────────────────────────────────────
# 마샬링: DynamoDB(snake) → GraphQL(camel)
# ─────────────────────────────────────────────────────────────────────────────


def _call_out(item: dict) -> dict:
    return {
        "id": item.get("callId"),
        "customerId": item.get("customerId"),
        "state": item.get("state"),
        "scenario": item.get("scenario"),
        "fraudSuspected": bool(item.get("fraud_suspected", False)),
        "startedAt": item.get("started_at"),
        "endedAt": item.get("ended_at"),
        "agentJoinedAt": item.get("agent_joined_at"),
    }


def _customer_out(item: dict) -> dict | None:
    if not item:
        return None
    return {
        "id": item.get("customerId"),
        "name": item.get("name"),
        "phone": item.get("phone"),
        "targetProduct": item.get("target_product"),
        "rate": item.get("rate"),
        "limit": item.get("limit"),
        "hasVehicle": bool(item.get("has_vehicle", False)),
        "creditScore": item.get("credit_score"),
    }


def _turn_out(item: dict) -> dict:
    return {
        "seq": item.get("seq"),
        "speaker": item.get("speaker"),
        "text": item.get("text"),
        "node": item.get("node"),
        "churnAfter": item.get("churn_after"),
        "flag": item.get("flag"),  # 턴 레벨 flag: "risk"|"def"|null (SSOT-3)
        "tokens": [
            {
                "text": t.get("text"),
                "polarity": t.get("polarity"),
                "reason": t.get("reason", ""),
            }
            for t in (item.get("tokens") or [])
        ],
    }


# ─────────────────────────────────────────────────────────────────────────────
# 상태 검증
# ─────────────────────────────────────────────────────────────────────────────


def _require_call(call_id: str) -> dict:
    item = dynamo.get_item(dynamo.pk_call(call_id), dynamo.SK_META)
    if not item:
        raise OrchestratorError("NOT_FOUND", f"call not found: {call_id}")
    return item


# ─────────────────────────────────────────────────────────────────────────────
# Mutations: createCall / dialCall
# ─────────────────────────────────────────────────────────────────────────────


def resolve_create_call(event: dict, args: dict) -> dict:
    """분석 전용 콜 생성 (state=CREATED). 발신하지 않음."""
    customer_id = args["customerId"]
    call_id = new_call_id()
    item = {
        "PK": dynamo.pk_call(call_id),
        "SK": dynamo.SK_META,
        "callId": call_id,
        "customerId": customer_id,
        "state": "CREATED",
        "started_at": now_iso(),
    }
    dynamo.put_item(item)
    return _call_out(item)


def resolve_dial_call(event: dict, args: dict) -> dict:
    """통화 버튼 발신. 이미 진행 중인 콜이 있으면 INVALID_STATE.

    행 클릭은 모니터링 진입일 뿐 — 발신은 이 뮤테이션(명시적 버튼)으로만 일어난다.
    """
    customer_id = args["customerId"]

    # 같은 고객의 진행 중 콜이 있으면 중복 발신 거부.
    existing = _active_call_for_customer(customer_id)
    if existing:
        raise OrchestratorError(
            "INVALID_STATE",
            f"customer {customer_id} already has an active call ({existing})",
        )

    call_id = new_call_id()
    item = {
        "PK": dynamo.pk_call(call_id),
        "SK": dynamo.SK_META,
        "callId": call_id,
        "customerId": customer_id,
        "state": "DIALING",
        "started_at": now_iso(),
    }
    dynamo.put_item(item)
    # 고객→활성콜 인덱스 (싱글 테이블, GSI 없이 중복 발신 검사용).
    dynamo.put_item({
        "PK": dynamo.pk_cust(customer_id),
        "SK": "ACTIVE_CALL",
        "callId": call_id,
    })
    return _call_out(item)


def _active_call_for_customer(customer_id: str) -> str | None:
    """활성(DIALING/IN_CALL/TRANSFER_PENDING) 콜이 있으면 callId 반환.

    싱글 테이블에 고객→콜 GSI가 없으므로, 활성 콜 인덱스 아이템
    (PK=CUST#, SK=ACTIVE_CALL)을 사용한다. dialCall이 이 인덱스를 갱신.
    """
    idx = dynamo.get_item(dynamo.pk_cust(customer_id), "ACTIVE_CALL")
    if not idx:
        return None
    call_id = idx.get("callId")
    if not call_id:
        return None
    call = dynamo.get_item(dynamo.pk_call(call_id), dynamo.SK_META)
    if call and call.get("state") in ACTIVE_STATES:
        return call_id
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Query: call snapshot
# ─────────────────────────────────────────────────────────────────────────────


def resolve_call(event: dict, args: dict) -> dict:
    """모니터링 스냅샷. call + customer + analysis + transcript + currentNode.

    analysis 형상 (SSOT-3): {strategyHeadline, rationale, churnRisk, emotion}.
    aiAction/data 필드 폐기.
    """
    call_id = args["id"]
    call = _require_call(call_id)

    customer = None
    if call.get("customerId"):
        customer = _customer_out(
            dynamo.get_item(dynamo.pk_cust(call["customerId"]), dynamo.SK_META) or {}
        )

    turns = dynamo.query(dynamo.pk_call(call_id), dynamo.SK_PREFIX_TURN)
    transcript = [_turn_out(t) for t in turns]

    # 최신 분석 스냅샷은 META 아이템에 누적 기록된다 (Streams 팬아웃과 동일 소스).
    analysis = {
        "strategyHeadline": call.get("strategy_headline"),
        "rationale": call.get("rationale"),
        "churnRisk": call.get("churn_risk"),
        "emotion": call.get("emotion"),
    }

    return {
        "call": _call_out(call),
        "customer": customer,
        "analysis": analysis,
        "transcript": transcript,
        "currentNode": call.get("current_node"),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Mutations: 콜 액션 4종
# ─────────────────────────────────────────────────────────────────────────────


def resolve_approve_product(event: dict, args: dict) -> dict:
    """상품 가입 승인. ENDED 상태에서는 INVALID_STATE."""
    call_id = args["callId"]
    product_id = args.get("productId")
    call = _require_call(call_id)
    if call.get("state") == "ENDED":
        raise OrchestratorError("INVALID_STATE", "call already ended")
    dynamo.update_fields(
        dynamo.pk_call(call_id), dynamo.SK_META,
        {"approved_product_id": product_id, "approved_at": now_iso()},
    )
    return {"ok": True, "callId": call_id, "productId": product_id}


def resolve_transfer_to_agent(event: dict, args: dict) -> dict:
    """상담원 연결 → state=TRANSFER_PENDING. ENDED면 INVALID_STATE."""
    call_id = args["callId"]
    call = _require_call(call_id)
    if call.get("state") == "ENDED":
        raise OrchestratorError("INVALID_STATE", "call already ended")
    item = dynamo.update_fields(
        dynamo.pk_call(call_id), dynamo.SK_META,
        {"state": "TRANSFER_PENDING", "agent_joined_at": now_iso()},
    )
    return _call_out(item)


def resolve_send_link(event: dict, args: dict) -> dict:
    """대출신청 URL 문자 발송. 데모: 실제 SMS 미발송, 발송 사실만 기록 (API.md §1.7)."""
    call_id = args["callId"]
    url = args["url"]
    call = _require_call(call_id)
    if call.get("state") == "ENDED":
        raise OrchestratorError("INVALID_STATE", "call already ended")
    dynamo.update_fields(
        dynamo.pk_call(call_id), dynamo.SK_META,
        {"link_sent_url": url, "link_sent_at": now_iso()},
    )
    return {"ok": True, "callId": call_id, "url": url}


def resolve_end_call(event: dict, args: dict) -> dict:
    """통화 종료 → state=ENDED + 요약 생성 트리거. 이미 ENDED면 INVALID_STATE."""
    call_id = args["callId"]
    call = _require_call(call_id)
    if call.get("state") == "ENDED":
        raise OrchestratorError("INVALID_STATE", "call already ended")
    item = dynamo.update_fields(
        dynamo.pk_call(call_id), dynamo.SK_META,
        {"state": "ENDED", "ended_at": now_iso()},
    )
    # 요약 생성 트리거. summaries.write_summary가 turn/MOT를 집계해 SUMMARY 기록.
    from .summaries import write_summary

    write_summary(call_id)
    return _call_out(item)
