"""DATA-001 (#1) — Customer 모델 마샬링/언마샬링 + persona Map round-trip."""

from __future__ import annotations

import pytest

from orchestrator.api import dynamo
from orchestrator.models.customer import CUSTOMERS_INDEX_PK, Customer

from ._fake_dynamo import FakeTable


@pytest.fixture(autouse=True)
def _fake_table():
    dynamo.set_table(FakeTable())
    yield
    dynamo.set_table(None)


def test_instance_defaults():
    c = Customer(id="u1")
    # existing_loans 기본값 {own:0, other:0}
    assert c.existing_loans == {"own": 0, "other": 0}
    assert c.has_vehicle is False
    assert c.persona == {}


def test_id_required():
    with pytest.raises(ValueError):
        Customer(id="")


def test_existing_loans_normalized():
    # 누락 키 0 보강 + 정수화
    c = Customer(id="u1", existing_loans={"own": "2"})
    assert c.existing_loans == {"own": 2, "other": 0}


def test_to_item_keys_match_resolver_contract():
    c = Customer(
        id="u1", name="박서준", phone="010", target_product="대환대출",
        rate="5.9%", limit=3000, existing_loans={"own": 1, "other": 2},
        has_vehicle=True, credit_score=744, scenario_hint="S1",
        persona={"job": "회사원"},
    )
    item = c.to_item()
    assert item["PK"] == dynamo.pk_cust("u1")
    assert item["SK"] == dynamo.SK_META
    # resolvers/customers.py:_customer_out 가 읽는 storage 키와 동일
    for key in ("customerId", "name", "phone", "target_product", "rate",
                "limit", "existing_loans", "has_vehicle", "credit_score",
                "scenario_hint"):
        assert key in item
    assert item["has_vehicle"] is True
    assert item["existing_loans"] == {"own": 1, "other": 2}


def test_index_item():
    c = Customer(id="u1", name="박서준")
    idx = c.to_index_item()
    assert idx["PK"] == CUSTOMERS_INDEX_PK
    assert idx["SK"] == "CUST#u1"
    assert idx["customerId"] == "u1"


def test_roundtrip_via_dynamo():
    c = Customer(id="u1", name="박서준", has_vehicle=True,
                 existing_loans={"own": 1, "other": 2}, persona={"job": "회사원"})
    dynamo.put_item(c.to_item())
    got = Customer.from_item(dynamo.get_item(dynamo.pk_cust("u1"), dynamo.SK_META))
    assert got == c


def test_persona_map_roundtrip():
    # persona dict ↔ DynamoDB Map(TypeSerializer/TypeDeserializer) round-trip
    c = Customer(id="u1", persona={"job": "회사원", "age": 41,
                                   "tags": ["vip", "차량보유"]})
    attr = c.persona_to_attr()
    assert "M" in attr  # DynamoDB Map attribute
    back = Customer.persona_from_attr(attr)
    assert back == {"job": "회사원", "age": 41, "tags": ["vip", "차량보유"]}
