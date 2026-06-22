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


if __name__ == "__main__":  # pragma: no cover — 수동 시드 실행 엔트리
    logging.basicConfig(level=logging.INFO)
    n = seed_customers()
    print(f"seeded {n} new customers ({len(SEED_CUSTOMERS)} total personas)")
