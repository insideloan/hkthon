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


def _customer_subtitle(cust: dict) -> str | None:
    """Customer META → 큐 row 부가정보 subtitle("41세·KCB744" 형식).

    age는 persona.age, 신용점수는 credit_score에서 파생한다(seed 형식과 일치).
    데이터가 없으면 가능한 부분만 — 둘 다 없으면 None(row에서 subtitle 생략).
    """
    parts: list[str] = []
    age = (cust.get("persona") or {}).get("age")
    if age:
        parts.append(f"{age}세")
    credit = cust.get("credit_score")
    if credit:
        parts.append(f"KCB{credit}")
    return "·".join(parts) or None


def _upsert_queue_index(call: dict) -> None:
    """큐 인덱스(PK=QUEUE, SK=CALL#{id}) 갱신.

    queue resolver가 읽는 스냅샷 소스. dialCall/상태변경이 호출해 META의
    최신 상태를 인덱스에 미러링한다 (queue.py가 query(PK=QUEUE)로 조회).
    META(snake)에서 큐 row가 쓰는 필드만 투영 — 고객명/단계/이탈위험 등 분석
    필드는 stream fanout이 META에 누적한 값을 그대로 따라온다.
    """
    call_id = call.get("callId")
    if not call_id:
        return
    item = {
        "PK": dynamo.PK_QUEUE,
        "SK": dynamo.sk_call(call_id),
        "callId": call_id,
        "state": call.get("state"),
        "started_at": call.get("started_at"),
    }
    # 선택 필드는 META에 있을 때만 미러링(없으면 row에서 None).
    # subtitle(나이·신용점수)은 createCall이 META에 한 번 박고 이후엔 안 바뀌므로
    # 미러링 목록에 포함하되, 상태변경 호출에 subtitle이 없을 때는 기존 큐 인덱스
    # 행의 값을 보존한다(put_item 전체 덮어쓰기로 seed/createCall subtitle이 날아가
    # 큐 부가정보가 null이 되던 버그 방지).
    for src in ("customer_name", "subtitle", "stage", "churn_risk", "assignee",
                "channel", "fraud_suspected", "needs_agent"):
        if call.get(src) is not None:
            item[src] = call[src]
    if "subtitle" not in item:
        prev = dynamo.get_item(dynamo.PK_QUEUE, dynamo.sk_call(call_id)) or {}
        if prev.get("subtitle") is not None:
            item["subtitle"] = prev["subtitle"]
    dynamo.put_item(item)


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


def analysis_call_id(customer_id: str) -> str:
    """분석 전용 콜의 결정적 id — 고객당 1개.

    createCall은 세그먼트 분석 화면 진입(/segment/{cust})마다 호출되는데, callId가
    이후 발신(dialCall은 customerId로 별도 콜 생성)에 쓰이지 않고 단지 발신 버튼을
    노출하는 게이트로만 쓰인다. 매번 new_call_id()로 c{timestamp}를 새로 박으면
    화면 재진입/새로고침/StrictMode 더블마운트/데모 반복마다 CREATED 콜이 무한
    누적된다(특히 박서준 booth 데모). 고객당 결정적 id를 쓰면 같은 레코드를
    덮어쓰므로 누적되지 않는다.
    """
    return f"c-analysis-{customer_id}"


def resolve_create_call(event: dict, args: dict) -> dict:
    """분석 전용 콜 생성 (state=CREATED). 발신하지 않음.

    고객당 결정적 id로 멱등 — 분석 화면 재진입 시 같은 레코드를 덮어써 누적을 막는다.
    활성 콜 인덱스/큐 인덱스는 건드리지 않으므로(발신은 dialCall) 큐에도 안 뜬다.
    """
    customer_id = args["customerId"]
    call_id = analysis_call_id(customer_id)
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
    """통화 버튼 발신. 이미 *연결된* 콜이 있으면 INVALID_STATE.

    행 클릭은 모니터링 진입일 뿐 — 발신은 이 뮤테이션(명시적 버튼)으로만 일어난다.

    중복 발신 처리: 같은 고객의 활성 콜이
      - IN_CALL / TRANSFER_PENDING (실제 통화 중) → INVALID_STATE 로 거부.
      - DIALING (발신만 하고 연결 안 됨) → stale 로 간주, 종료하고 재발신 진행.
    DIALING 은 과도 상태(벨 울리는 중)라 연결되지 못한 채 남으면 ACTIVE_CALL 인덱스가
    영구히 잠겨 재발신이 불가능해진다(발신 화면엔 endCall 경로 없음). 다시 발신 버튼을
    누른 의도는 명백히 재발신이므로, 묵은 DIALING 콜은 ENDED 처리하고 새 콜을 만든다.
    """
    customer_id = args["customerId"]

    existing = _active_call_for_customer(customer_id)
    if existing:
        if existing["state"] in ("IN_CALL", "TRANSFER_PENDING"):
            raise OrchestratorError(
                "INVALID_STATE",
                f"customer {customer_id} already has an active call "
                f"({existing['callId']})",
            )
        # state == DIALING: 연결되지 않은 묵은 발신 — 종료하고 재발신을 진행한다.
        stale = dynamo.update_fields(
            dynamo.pk_call(existing["callId"]), dynamo.SK_META,
            {"state": "ENDED", "ended_at": now_iso()},
        )
        _upsert_queue_index(stale)

    # 큐 row에 고객명을 띄우기 위해 발신 시점 META에 미러링(스냅샷용, 선택).
    cust = dynamo.get_item(dynamo.pk_cust(customer_id), dynamo.SK_META) or {}

    call_id = new_call_id()
    item = {
        "PK": dynamo.pk_call(call_id),
        "SK": dynamo.SK_META,
        "callId": call_id,
        "customerId": customer_id,
        "state": "DIALING",
        "started_at": now_iso(),
    }
    if cust.get("name"):
        item["customer_name"] = cust["name"]
    subtitle = _customer_subtitle(cust)
    if subtitle:
        item["subtitle"] = subtitle
    dynamo.put_item(item)
    # 고객→활성콜 인덱스 (싱글 테이블, GSI 없이 중복 발신 검사용).
    dynamo.put_item({
        "PK": dynamo.pk_cust(customer_id),
        "SK": "ACTIVE_CALL",
        "callId": call_id,
    })
    # 큐 인덱스 갱신 — queue resolver 스냅샷 소스(PK=QUEUE).
    _upsert_queue_index(item)
    return _call_out(item)


def _active_call_for_customer(customer_id: str) -> dict | None:
    """활성(DIALING/IN_CALL/TRANSFER_PENDING) 콜이 있으면 {callId, state} 반환.

    싱글 테이블에 고객→콜 GSI가 없으므로, 활성 콜 인덱스 아이템
    (PK=CUST#, SK=ACTIVE_CALL)을 사용한다. dialCall이 이 인덱스를 갱신.
    호출부가 DIALING(묵은 발신) vs IN_CALL/TRANSFER_PENDING(연결됨)을 구분해야
    하므로 state 까지 함께 돌려준다.
    """
    idx = dynamo.get_item(dynamo.pk_cust(customer_id), "ACTIVE_CALL")
    if not idx:
        return None
    call_id = idx.get("callId")
    if not call_id:
        return None
    call = dynamo.get_item(dynamo.pk_call(call_id), dynamo.SK_META)
    if call and call.get("state") in ACTIVE_STATES:
        return {"callId": call_id, "state": call["state"]}
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
    _upsert_queue_index(item)
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
    _upsert_queue_index(item)
    # 요약 생성 트리거. summaries.write_summary가 turn/MOT를 집계해 SUMMARY 기록.
    from .summaries import write_summary

    write_summary(call_id)
    return _call_out(item)
