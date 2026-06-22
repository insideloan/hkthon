"""BACKEND-008 (#27) — callSummary / customer / customers + 요약 write path."""

from __future__ import annotations

import pytest

from orchestrator.api import dynamo
from orchestrator.handler import OrchestratorError
from orchestrator.resolvers import customers, summaries

from ._fake_dynamo import FakeTable


@pytest.fixture(autouse=True)
def _fake_table():
    dynamo.set_table(FakeTable())
    yield
    dynamo.set_table(None)


def test_summary_roundtrip_with_mots():
    cid = "c1"
    dynamo.put_item({"PK": dynamo.pk_call(cid), "SK": "META", "callId": cid,
                     "strategy_headline": "대환 비교", "rationale": "절감 강조"})
    dynamo.put_item({"PK": dynamo.pk_call(cid), "SK": dynamo.sk_turn(1),
                     "seq": 1, "node": "classify"})
    dynamo.put_item({"PK": dynamo.pk_call(cid), "SK": dynamo.sk_mot(1),
                     "markerId": "MOT_1", "state": "BLOCKED", "stage": "TRUST",
                     "turn_seq": 1})
    summaries.write_summary(cid)

    res = summaries.resolve_call_summary({}, {"id": cid})
    assert res["callId"] == cid
    assert res["mots"][0]["markerId"] == "MOT_1"
    assert res["mots"][0]["stage"] == "TRUST"
    assert res["strategyHeadline"] == "대환 비교"
    assert "classify" in res["flow"]


def test_summary_mots_deprecated_fields_absent():
    cid = "c2"
    dynamo.put_item({"PK": dynamo.pk_call(cid), "SK": "META", "callId": cid})
    dynamo.put_item({"PK": dynamo.pk_call(cid), "SK": dynamo.sk_mot(1),
                     "markerId": "MOT_2", "state": "ALERT", "stage": "OBJECTION",
                     "turn_seq": 1, "type": "RISK", "narrative": "x"})
    summaries.write_summary(cid)
    m = summaries.resolve_call_summary({}, {"id": cid})["mots"][0]
    for dead in ("type", "narrative", "churnBefore", "churnAfter"):
        assert dead not in m


def test_summary_not_found():
    with pytest.raises(OrchestratorError) as ei:
        summaries.resolve_call_summary({}, {"id": "none"})
    assert ei.value.error_type == "NOT_FOUND"


def test_customer_single_and_list():
    dynamo.put_item({"PK": dynamo.pk_cust("u1"), "SK": "META", "customerId": "u1",
                     "name": "박서준", "has_vehicle": True,
                     "existing_loans": {"own": 1, "other": 2}})
    dynamo.put_item({"PK": "CUSTOMERS", "SK": "CUST#u1", "customerId": "u1",
                     "name": "박서준"})
    one = customers.resolve_customer({}, {"id": "u1"})
    assert one["name"] == "박서준"
    assert one["existingLoans"] == {"own": 1, "other": 2}
    assert one["hasVehicle"] is True
    lst = customers.resolve_customers({}, {})
    assert any(c["id"] == "u1" for c in lst)


def test_customer_not_found():
    with pytest.raises(OrchestratorError) as ei:
        customers.resolve_customer({}, {"id": "none"})
    assert ei.value.error_type == "NOT_FOUND"
