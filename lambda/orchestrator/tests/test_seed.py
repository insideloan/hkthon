"""DATA-007 (#7) — 페르소나 고객 10명 시드 + 멱등 conditional put."""

from __future__ import annotations

import pytest

from orchestrator import seed
from orchestrator.api import dynamo
from orchestrator.models.customer import CUSTOMERS_INDEX_PK, Customer
from orchestrator.resolvers import queue

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


# ── 데모 큐 시드 (PK=QUEUE) ──────────────────────────────────────────────────────


def test_seed_queue_writes_nine_rows():
    n = seed.seed_queue()
    assert n == 9
    # queue resolver가 시드 행을 그대로 스냅샷으로 반환.
    res = queue.resolve_queue({}, {})
    assert res["summary"]["total"] == 9
    assert {r["customerName"] for r in res["rows"]} >= {"박서준", "정민서"}


def test_seed_queue_states_are_canonical_enum():
    # schema.graphql:15 — CallState enum 밖의 값이 새지 않아야 한다.
    seed.seed_queue()
    valid = {"CREATED", "DIALING", "IN_CALL", "TRANSFER_PENDING", "ENDED"}
    states = {r["state"] for r in queue.resolve_queue({}, {})["rows"]}
    assert states <= valid


def test_seed_queue_elapsed_is_relative_not_static():
    # started_at은 적재 시점 기준으로 계산 → IN_CALL 행은 양의 elapsed.
    seed.seed_queue()
    rows = {r["callId"]: r for r in queue.resolve_queue({}, {})["rows"]}
    assert rows["c-demo-02"]["elapsedSec"] > 0      # elapsed_sec=221
    assert rows["c-demo-01"]["elapsedSec"] == 0     # elapsed_sec=0


def test_seed_queue_highlights_transfer_pending():
    seed.seed_queue()
    res = queue.resolve_queue({}, {"highlightOnly": True})
    assert {r["callId"] for r in res["rows"]} == {"c-demo-04", "c-demo-05"}
    assert all(r["highlight"] == "needs_agent" for r in res["rows"])


def test_seed_queue_rerun_refreshes():
    # 멱등 skip이 아니라 덮어쓰기 — 재실행이 항상 9행을 다시 쓴다.
    seed.seed_queue()
    seed.seed_queue()
    assert queue.resolve_queue({}, {})["summary"]["total"] == 9
