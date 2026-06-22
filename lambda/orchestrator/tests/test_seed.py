"""DATA-007 (#7) — 페르소나 고객 10명 시드 + 멱등 conditional put."""

from __future__ import annotations

import pytest

from orchestrator import seed
from orchestrator.api import dynamo
from orchestrator.models.customer import CUSTOMERS_INDEX_PK, Customer

from ._fake_dynamo import FakeTable


class ConditionalFakeTable(FakeTable):
    """FakeTable + ConditionExpression="attribute_not_exists(PK)" 지원.

    seed.py 의 멱등 conditional put을 단위테스트하기 위한 최소 확장. 조건 위반 시
    boto3 와 동일한 이름의 예외(ConditionalCheckFailedException)를 raise한다.
    """

    def put_item(self, Item, ConditionExpression=None):  # noqa: N803
        if ConditionExpression == "attribute_not_exists(PK)":
            if (Item["PK"], Item["SK"]) in self.store:
                raise type(
                    "ConditionalCheckFailedException", (Exception,), {}
                )()
        return super().put_item(Item=Item)


@pytest.fixture(autouse=True)
def _fake_table():
    dynamo.set_table(ConditionalFakeTable())
    yield
    dynamo.set_table(None)


def _count_customers() -> int:
    return len(dynamo.query(CUSTOMERS_INDEX_PK, "CUST#"))


def test_seed_inserts_ten_customers():
    inserted = seed.seed_customers()
    assert inserted == 10
    assert _count_customers() == 10


def test_park_seojun_persona():
    seed.seed_customers()
    items = dynamo.query(CUSTOMERS_INDEX_PK, "CUST#")
    names = {i["name"] for i in items}
    assert "박서준" in names

    # META 아이템에서 KCB744·차량보유·S1 페르소나 검증
    park = next(c for c in seed.SEED_CUSTOMERS if c.name == "박서준")
    item = dynamo.get_item(dynamo.pk_cust(park.id), dynamo.SK_META)
    got = Customer.from_item(item)
    assert got.credit_score == 744          # KCB 744점
    assert got.has_vehicle is True          # 차량보유
    assert got.scenario_hint == "S1"        # S1 페르소나


def test_seed_is_idempotent():
    first = seed.seed_customers()
    assert first == 10
    # 재실행 — conditional put 으로 중복 삽입 없음
    second = seed.seed_customers()
    assert second == 0
    assert _count_customers() == 10


def test_seed_idempotent_does_not_overwrite():
    seed.seed_customers()
    park = next(c for c in seed.SEED_CUSTOMERS if c.name == "박서준")
    # 기존 아이템을 변형해도 재시드가 덮어쓰지 않아야 함
    dynamo.update_fields(dynamo.pk_cust(park.id), dynamo.SK_META,
                         {"name": "변경됨"})
    seed.seed_customers()
    item = dynamo.get_item(dynamo.pk_cust(park.id), dynamo.SK_META)
    assert item["name"] == "변경됨"  # conditional put 이 skip → 보존
