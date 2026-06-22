"""BACKEND-003 (#22) — queue resolver."""

from __future__ import annotations

import pytest

from orchestrator.api import dynamo
from orchestrator.resolvers import queue

from ._fake_dynamo import FakeTable


@pytest.fixture(autouse=True)
def _fake_table():
    dynamo.set_table(FakeTable())
    yield
    dynamo.set_table(None)


def _seed_queue_row(call_id, **kw):
    item = {"PK": "QUEUE", "SK": f"CALL#{call_id}", "callId": call_id}
    item.update(kw)
    dynamo.put_item(item)


def test_queue_returns_summary_and_rows():
    _seed_queue_row("a", state="IN_CALL", churn_risk=30)
    _seed_queue_row("b", state="TRANSFER_PENDING")
    _seed_queue_row("c", state="IN_CALL", fraud_suspected=True)
    res = queue.resolve_queue({}, {})
    assert res["summary"]["total"] == 3
    assert res["summary"]["needsAgent"] == 1      # b
    assert res["summary"]["fraudSuspected"] == 1  # c
    assert res["summary"]["inCall"] == 2          # a, c
    assert {r["callId"] for r in res["rows"]} == {"a", "b", "c"}


def test_queue_highlight_only():
    _seed_queue_row("a", state="IN_CALL")
    _seed_queue_row("b", state="TRANSFER_PENDING")
    res = queue.resolve_queue({}, {"highlightOnly": True})
    assert [r["callId"] for r in res["rows"]] == ["b"]
    assert res["rows"][0]["highlight"] == "needs_agent"


def test_queue_row_schema():
    _seed_queue_row("a", state="IN_CALL", customer_name="박서준", churn_risk=44,
                    channel="agent", assignee="김상담")
    row = queue.resolve_queue({}, {})["rows"][0]
    for k in ("callId", "customerName", "state", "churnRisk", "assignee",
              "channel", "elapsedSec", "highlight"):
        assert k in row
