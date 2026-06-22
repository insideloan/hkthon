"""Customer 엔터티 모델 (DATA-001 / #1).

고객 프로필 — 모든 화면의 기준 데이터. DynamoDB 싱글 테이블에 META 아이템으로
저장되며(`CUST#{id}` / `META`), 목록 조회용 인덱스 아이템(`CUSTOMERS` / `CUST#{id}`)
과 함께 쓰인다.

스토리지 포맷은 `api/dynamo.py`(boto3 high-level Table resource)와 정합한다 — 즉
`to_item()`은 평탄한 Python dict를 반환하고, nested map(`existing_loans`/`persona`)은
resource가 DynamoDB Map(`M`)으로 자동 마샬링한다. 필드명은 GraphQL `type Customer`
(graphql/schema.graphql §Customer)와 resolver(`resolvers/customers.py`)의 storage 키에
1:1 대응한다.

persona dict ↔ DynamoDB Map round-trip은 boto3 `TypeSerializer/TypeDeserializer`로
검증한다(`persona_to_attr`/`persona_from_attr`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from ..api import dynamo

# 목록 조회 인덱스 (resolvers/customers.py:resolve_customers 와 동일 계약)
CUSTOMERS_INDEX_PK = "CUSTOMERS"


def _index_sk(customer_id: str) -> str:
    return f"CUST#{customer_id}"


def _default_loans() -> dict[str, int]:
    return {"own": 0, "other": 0}


@dataclass
class Customer:
    """고객 프로필 도메인 모델.

    필드는 GraphQL `type Customer`와 매핑된다. storage 키(`to_item`)는 snake_case,
    GraphQL/resolver 출력은 camelCase(`resolvers/customers.py:_customer_out`).
    """

    id: str
    name: Optional[str] = None
    phone: Optional[str] = None
    target_product: Optional[str] = None
    rate: Optional[str] = None
    limit: Optional[int] = None
    existing_loans: dict[str, int] = field(default_factory=_default_loans)
    has_vehicle: bool = False
    credit_score: Optional[int] = None
    persona: dict[str, Any] = field(default_factory=dict)
    scenario_hint: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.id:
            raise ValueError("Customer.id is required")
        # existing_loans 는 {own,other} 정수 맵으로 정규화 (누락 키 0 보강).
        loans = dict(self.existing_loans or {})
        self.existing_loans = {
            "own": int(loans.get("own", 0)),
            "other": int(loans.get("other", 0)),
        }

    # -- DynamoDB 마샬링 (high-level Table resource: 평탄 dict) ------------------

    def to_item(self) -> dict[str, Any]:
        """META 아이템(dict)으로 마샬링. PK=CUST#{id}, SK=META."""
        return {
            "PK": dynamo.pk_cust(self.id),
            "SK": dynamo.SK_META,
            "customerId": self.id,
            "name": self.name,
            "phone": self.phone,
            "target_product": self.target_product,
            "rate": self.rate,
            "limit": self.limit,
            "existing_loans": dict(self.existing_loans),
            "has_vehicle": bool(self.has_vehicle),
            "credit_score": self.credit_score,
            "persona": dict(self.persona),
            "scenario_hint": self.scenario_hint,
        }

    def to_index_item(self) -> dict[str, Any]:
        """목록 조회용 인덱스 아이템. PK=CUSTOMERS, SK=CUST#{id}."""
        return {
            "PK": CUSTOMERS_INDEX_PK,
            "SK": _index_sk(self.id),
            "customerId": self.id,
            "name": self.name,
        }

    @classmethod
    def from_item(cls, item: dict[str, Any]) -> "Customer":
        """META 아이템(dict) → Customer 언마샬링."""
        return cls(
            id=item["customerId"],
            name=item.get("name"),
            phone=item.get("phone"),
            target_product=item.get("target_product"),
            rate=item.get("rate"),
            limit=item.get("limit"),
            existing_loans=dict(item.get("existing_loans") or {}),
            has_vehicle=bool(item.get("has_vehicle", False)),
            credit_score=item.get("credit_score"),
            persona=dict(item.get("persona") or {}),
            scenario_hint=item.get("scenario_hint"),
        )

    # -- persona dict ↔ DynamoDB Map (low-level TypeSerializer round-trip) ------

    def persona_to_attr(self) -> dict[str, Any]:
        """persona dict → DynamoDB Map attribute({"M": {...}}). boto3 TypeSerializer."""
        from boto3.dynamodb.types import TypeSerializer

        return TypeSerializer().serialize(dict(self.persona))

    @staticmethod
    def persona_from_attr(attr: dict[str, Any]) -> dict[str, Any]:
        """DynamoDB Map attribute → persona dict. boto3 TypeDeserializer."""
        from boto3.dynamodb.types import TypeDeserializer

        return TypeDeserializer().deserialize(attr)
