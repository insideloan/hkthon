"""BACKEND-002 (#21) — DynamoDB 액세스 레이어 (fake 테이블 주입, moto 불필요)."""

from __future__ import annotations

import pytest

from orchestrator.api import dynamo

from ._fake_dynamo import FakeTable


@pytest.fixture(autouse=True)
def _fake_table():
    t = FakeTable()
    dynamo.set_table(t)
    yield t
    dynamo.set_table(None)


def test_put_get_roundtrip():
    dynamo.put_item({"PK": "CALL#1", "SK": "META", "callId": "1", "state": "CREATED"})
    got = dynamo.get_item("CALL#1", "META")
    assert got["callId"] == "1"
    assert got["state"] == "CREATED"


def test_get_missing_returns_none():
    assert dynamo.get_item("CALL#nope", "META") is None


def test_put_requires_keys():
    with pytest.raises(ValueError):
        dynamo.put_item({"callId": "1"})


def test_query_by_pk_with_prefix():
    dynamo.put_item({"PK": "CALL#1", "SK": dynamo.sk_turn(1), "seq": 1})
    dynamo.put_item({"PK": "CALL#1", "SK": dynamo.sk_turn(2), "seq": 2})
    dynamo.put_item({"PK": "CALL#1", "SK": "META", "state": "x"})
    turns = dynamo.query("CALL#1", dynamo.SK_PREFIX_TURN)
    assert [t["seq"] for t in turns] == [1, 2]


def test_query_pk_only_returns_all():
    dynamo.put_item({"PK": "CALL#1", "SK": "META"})
    dynamo.put_item({"PK": "CALL#1", "SK": dynamo.sk_turn(1)})
    assert len(dynamo.query("CALL#1")) == 2


def test_update_fields_sets_and_returns():
    dynamo.put_item({"PK": "CALL#1", "SK": "META", "state": "DIALING"})
    out = dynamo.update_fields("CALL#1", "META", {"state": "ENDED", "ended_at": "t"})
    assert out["state"] == "ENDED"
    assert out["ended_at"] == "t"
    assert dynamo.get_item("CALL#1", "META")["state"] == "ENDED"


def test_key_builders():
    assert dynamo.pk_call("a") == "CALL#a"
    assert dynamo.pk_cust("b") == "CUST#b"
    assert dynamo.sk_turn(5) == "TURN#0005"
    assert dynamo.sk_mot(12) == "MOT#0012"
    assert dynamo.sk_cmpl(3, 1) == "CMPL#3#1"
