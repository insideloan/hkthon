"""데모 시드 데이터 — 페르소나 고객 10명 (DATA-007 / #7).

데모 시작 시 박서준 등 페르소나 고객이 DynamoDB에 있어야 한다. boto3 싱글 테이블에
`Customer` 모델로 삽입한다(NOT DuckDB/SQL). `put_item`에
`ConditionExpression="attribute_not_exists(PK)"`를 걸어 멱등 conditional put —
재실행해도 기존 고객을 덮어쓰지 않는다.

각 고객은 META 아이템(`CUST#{id}` / `META`) + 목록 인덱스 아이템
(`CUSTOMERS` / `CUST#{id}`) 두 건으로 저장된다(resolvers/customers.py 계약).
"""

from __future__ import annotations

import logging
import time
from typing import Any

from .api import dynamo
from .models.customer import Customer

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# 페르소나 고객 10명 (데모 SSOT). 박서준 = S1 시나리오 기준 페르소나.
#   - credit_score 744 = KCB 744점 (한국 신용평가사 점수)
#   - has_vehicle=True → MOT_4(차량담보 오해) 시나리오와 연관
# ─────────────────────────────────────────────────────────────────────────────

SEED_CUSTOMERS: list[Customer] = [
    Customer(
        id="cust-001", name="박서준", phone="010-1111-0001",
        target_product="대환대출", rate="5.9%", limit=3000,
        existing_loans={"own": 1, "other": 2}, has_vehicle=True,
        credit_score=744, scenario_hint="S1",
        persona={"job": "회사원", "age": 41, "tags": ["S1", "차량보유"]},
    ),
    Customer(
        id="cust-002", name="김민지", phone="010-1111-0002",
        target_product="신용대출", rate="6.4%", limit=2000,
        existing_loans={"own": 0, "other": 1}, has_vehicle=False,
        credit_score=812, scenario_hint="S2",
        persona={"job": "디자이너", "age": 29, "tags": ["S2"]},
    ),
    Customer(
        id="cust-003", name="이준호", phone="010-1111-0003",
        target_product="대환대출", rate="7.1%", limit=1500,
        existing_loans={"own": 2, "other": 3}, has_vehicle=True,
        credit_score=678, scenario_hint="S1",
        persona={"job": "자영업", "age": 47, "tags": ["S1", "차량보유"]},
    ),
    Customer(
        id="cust-004", name="최수아", phone="010-1111-0004",
        target_product="전세자금대출", rate="4.8%", limit=8000,
        existing_loans={"own": 0, "other": 0}, has_vehicle=False,
        credit_score=905, scenario_hint="S3",
        persona={"job": "교사", "age": 34, "tags": ["S3"]},
    ),
    Customer(
        id="cust-005", name="정태현", phone="010-1111-0005",
        target_product="신용대출", rate="8.2%", limit=1000,
        existing_loans={"own": 1, "other": 4}, has_vehicle=False,
        credit_score=601, scenario_hint="S2",
        persona={"job": "프리랜서", "age": 38, "tags": ["S2"]},
    ),
    Customer(
        id="cust-006", name="한지우", phone="010-1111-0006",
        target_product="대환대출", rate="6.0%", limit=2500,
        existing_loans={"own": 1, "other": 1}, has_vehicle=True,
        credit_score=755, scenario_hint="S1",
        persona={"job": "간호사", "age": 31, "tags": ["S1", "차량보유"]},
    ),
    Customer(
        id="cust-007", name="오세훈", phone="010-1111-0007",
        target_product="신용대출", rate="7.7%", limit=1800,
        existing_loans={"own": 0, "other": 2}, has_vehicle=False,
        credit_score=689, scenario_hint="S2",
        persona={"job": "엔지니어", "age": 44, "tags": ["S2"]},
    ),
    Customer(
        id="cust-008", name="윤서연", phone="010-1111-0008",
        target_product="전세자금대출", rate="5.1%", limit=6000,
        existing_loans={"own": 0, "other": 1}, has_vehicle=False,
        credit_score=843, scenario_hint="S3",
        persona={"job": "변호사", "age": 36, "tags": ["S3"]},
    ),
    Customer(
        id="cust-009", name="강도윤", phone="010-1111-0009",
        target_product="대환대출", rate="6.8%", limit=2200,
        existing_loans={"own": 2, "other": 2}, has_vehicle=True,
        credit_score=712, scenario_hint="S1",
        persona={"job": "택시기사", "age": 52, "tags": ["S1", "차량보유"]},
    ),
    Customer(
        id="cust-010", name="임하늘", phone="010-1111-0010",
        target_product="신용대출", rate="6.2%", limit=2700,
        existing_loans={"own": 1, "other": 0}, has_vehicle=False,
        credit_score=798, scenario_hint="S2",
        persona={"job": "마케터", "age": 27, "tags": ["S2"]},
    ),
]


def _conditional_put(item: dict[str, Any]) -> bool:
    """PK가 없을 때만 put (멱등). 이미 있으면 False, 새로 넣으면 True.

    boto3 ConditionalCheckFailedException 은 클라이언트 예외 클래스로 잡되,
    fake 테이블/오프라인 환경에선 동일 이름의 예외를 raise하므로 이름으로도 방어.
    """
    table = dynamo.get_table()
    try:
        table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(PK)",
        )
        return True
    except Exception as exc:  # noqa: BLE001 — conditional 실패만 선별
        name = type(exc).__name__
        client_err = getattr(getattr(table, "meta", None), "client", None)
        cond_exc = getattr(
            getattr(client_err, "exceptions", None),
            "ConditionalCheckFailedException", None,
        )
        if (cond_exc is not None and isinstance(exc, cond_exc)) or \
                name == "ConditionalCheckFailedException":
            logger.info("seed: %s already exists, skip", item.get("PK"))
            return False
        raise


def seed_customers(customers: list[Customer] | None = None) -> int:
    """페르소나 고객을 멱등하게 시드. 새로 삽입된 고객 수를 반환.

    각 고객마다 META 아이템 + 목록 인덱스 아이템을 conditional put 한다.
    """
    customers = customers if customers is not None else SEED_CUSTOMERS
    inserted = 0
    for c in customers:
        created = _conditional_put(c.to_item())
        # 인덱스 아이템도 동일 멱등 정책으로 동기 삽입.
        _conditional_put(c.to_index_item())
        if created:
            inserted += 1
    logger.info("seed_customers: %d/%d inserted", inserted, len(customers))
    return inserted


# ─────────────────────────────────────────────────────────────────────────────
# 데모용 큐 스냅샷 9행 (docs/consult_redesigned-3.html 의 CALLS 배열).
#
# queue resolver가 읽는 큐 인덱스(PK=QUEUE, SK=CALL#{id})에 직접 적재한다.
# 시연 시작 시 관리자 대시보드가 "살아있는" 상태로 보이게 하는 용도.
# 실제 booth 콜(dialCall → c{ts} 아이템)은 이 위에 누적된다 — ID가 겹치지 않으므로
# 데모 행과 라이브 행이 공존한다.
#
# started_at은 적재 시점에 elapsed_sec 오프셋으로 계산한다 — 정적 타임스탬프를
# 박아두면 시연 당일 elapsedSec이 어긋나므로, 시드를 다시 실행하면 항상 맞는다.
# state는 canonical SDL enum (schema.graphql): CREATED DIALING IN_CALL
# TRANSFER_PENDING ENDED. (프로토타입의 pre/live/wait/done/miss → 아래 매핑.)
# ─────────────────────────────────────────────────────────────────────────────

# (call_id, customer_name, state, stage, churn_risk, assignee, channel,
#  elapsed_sec, highlight)
SEED_QUEUE_ROWS: list[dict[str, Any]] = [
    # pre → DIALING
    {"id": "c-demo-01", "customer_name": "박서준", "subtitle": "38세·KCB744",
     "state": "DIALING", "stage": "사전 분석중", "churn_risk": 34, "assignee": "Agent #3",
     "channel": "아웃바운드", "elapsed_sec": 0},
    # live → IN_CALL
    {"id": "c-demo-02", "customer_name": "이정훈", "subtitle": "45세·KCB701",
     "state": "IN_CALL", "stage": "우려 해소중", "churn_risk": 48, "assignee": "Agent #7",
     "channel": "아웃바운드", "elapsed_sec": 221},
    {"id": "c-demo-03", "customer_name": "김하늘", "subtitle": "33세·KCB762",
     "state": "IN_CALL", "stage": "신뢰 형성중", "churn_risk": 34, "assignee": "Agent #2",
     "channel": "인바운드", "elapsed_sec": 68},
    # wait → TRANSFER_PENDING (needs_agent highlight)
    {"id": "c-demo-04", "customer_name": "정민서", "subtitle": "29세·KCB688",
     "state": "TRANSFER_PENDING", "stage": "연결 대기", "churn_risk": 55, "assignee": None,
     "channel": "인바운드", "elapsed_sec": 92, "needs_agent": True},
    {"id": "c-demo-05", "customer_name": "한지우", "subtitle": "51세·KCB720",
     "state": "TRANSFER_PENDING", "stage": "연결 대기", "churn_risk": 40, "assignee": None,
     "channel": "아웃바운드", "elapsed_sec": 203, "needs_agent": True},
    # done → ENDED
    {"id": "c-demo-06", "customer_name": "오세훈", "subtitle": "41세·KCB745",
     "state": "ENDED", "stage": "문자URL 발송", "churn_risk": 18, "assignee": "Agent #1",
     "channel": "인바운드", "elapsed_sec": 475},
    {"id": "c-demo-07", "customer_name": "배수지", "subtitle": "36세·KCB733",
     "state": "ENDED", "stage": "대출 접수", "churn_risk": 12, "assignee": "Agent #4",
     "channel": "아웃바운드", "elapsed_sec": 330},
    # miss → ENDED
    {"id": "c-demo-08", "customer_name": "윤재호", "subtitle": "48세·KCB695",
     "state": "ENDED", "stage": "차량명의 이탈", "churn_risk": 88, "assignee": "Agent #11",
     "channel": "아웃바운드", "elapsed_sec": 134},
    {"id": "c-demo-09", "customer_name": "강예린", "subtitle": "27세·KCB710",
     "state": "ENDED", "stage": "TM거부 이탈", "churn_risk": 94, "assignee": "Agent #13",
     "channel": "인바운드", "elapsed_sec": 46},
]


def _queue_item(row: dict[str, Any], now: float) -> dict[str, Any]:
    """큐 시드 행 → 큐 인덱스 아이템. started_at은 now - elapsed_sec로 계산.

    필드 네이밍은 resolvers/queue.py:_row_out 계약(snake_case)을 따른다.
    """
    started = time.strftime("%Y-%m-%dT%H:%M:%SZ",
                            time.gmtime(now - row["elapsed_sec"]))
    item = {
        "PK": dynamo.PK_QUEUE,
        "SK": dynamo.sk_call(row["id"]),
        "callId": row["id"],
        "customer_name": row["customer_name"],
        "state": row["state"],
        "stage": row["stage"],
        "churn_risk": row["churn_risk"],
        "channel": row["channel"],
        "started_at": started,
    }
    if row.get("subtitle"):
        item["subtitle"] = row["subtitle"]
    if row.get("assignee"):
        item["assignee"] = row["assignee"]
    if row.get("needs_agent"):
        item["needs_agent"] = True
    if row.get("fraud_suspected"):
        item["fraud_suspected"] = True
    return item


def seed_queue(rows: list[dict[str, Any]] | None = None) -> int:
    """데모 큐 9행을 큐 인덱스(PK=QUEUE)에 적재. 삽입된 행 수 반환.

    고객 시드와 달리 **무조건 덮어쓴다** (conditional 아님) — 시연 직전 재실행으로
    started_at/elapsed를 갱신하는 게 목적이므로 멱등 skip은 오히려 방해다.
    데모 행 ID(c-demo-NN)는 라이브 booth 콜(c{ts})과 겹치지 않는다.
    """
    rows = rows if rows is not None else SEED_QUEUE_ROWS
    now = time.time()
    for row in rows:
        dynamo.put_item(_queue_item(row, now))
    logger.info("seed_queue: %d demo queue rows written", len(rows))
    return len(rows)


def cleanup_orphan_calls() -> int:
    """누적된 분석 전용(CREATED) 고아 콜 META를 정리. 삭제한 아이템 수 반환.

    배경: createCall이 예전엔 매 호출 c{timestamp} 새 id로 CREATED 콜을 박아,
    박서준(booth) 세그먼트 화면을 재진입할 때마다 아무도 소비하지 않는 콜이
    DynamoDB에 무한 누적됐다(이후 createCall은 고객당 결정적 id로 멱등 수정됨).
    이 함수는 그 잔재를 일괄 삭제한다.

    삭제 대상은 **CREATED 상태의 CALL#/META** 아이템만:
      - 발신된 콜(DIALING/IN_CALL/.../ENDED)은 건드리지 않는다(상태가 CREATED 아님).
      - 시드 데모 큐 행(c-demo-NN)은 QUEUE 인덱스 아이템이라 여기 안 걸린다.
      - 결정적 분석 id(c-analysis-*)도 CREATED지만, 멱등이라 1개뿐이므로 같이 지워도
        다음 진입 시 재생성된다 — 잔재 청소가 목적이라 전부 제거한다.
    CREATED는 활성콜/큐 인덱스를 만들지 않으므로 META만 지우면 완전 정리된다.
    """
    metas = dynamo.scan(sk=dynamo.SK_META)
    deleted = 0
    for m in metas:
        pk = str(m.get("PK", ""))
        if pk.startswith(dynamo.SK_PREFIX_CALL) and m.get("state") == "CREATED":
            dynamo.delete_item(pk, dynamo.SK_META)
            deleted += 1
    logger.info("cleanup_orphan_calls: %d CREATED call metas deleted", deleted)
    return deleted


if __name__ == "__main__":  # pragma: no cover — 수동 시드 실행 엔트리
    logging.basicConfig(level=logging.INFO)
    n = seed_customers()
    q = seed_queue()
    print(f"seeded {n} new customers ({len(SEED_CUSTOMERS)} personas) "
          f"+ {q} demo queue rows")
