"""Product 엔터티 모델 (DATA-006 / #6).

상품 정보. PK `PROD#{id}` / SK `META`. SSOT-3 변경 없음(유지).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from ..api import dynamo


@dataclass
class Product:
    """대출 상품. PK=PROD#{id}, SK=META."""

    id: str
    name: Optional[str] = None
    rate: Optional[str] = None
    limit: Optional[int] = None
    description: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.id:
            raise ValueError("Product.id is required")

    def to_item(self) -> dict[str, Any]:
        return {
            "PK": dynamo.pk_prod(self.id),
            "SK": dynamo.SK_META,
            "productId": self.id,
            "name": self.name,
            "rate": self.rate,
            "limit": self.limit,
            "description": self.description,
        }

    @classmethod
    def from_item(cls, item: dict[str, Any]) -> "Product":
        return cls(
            id=item["productId"],
            name=item.get("name"),
            rate=item.get("rate"),
            limit=item.get("limit"),
            description=item.get("description"),
        )
