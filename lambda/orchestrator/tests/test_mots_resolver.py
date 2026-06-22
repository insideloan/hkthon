"""BACKEND-007 (#26) — mots resolver, SSOT-3 신규 형상."""

from __future__ import annotations

import pytest

from orchestrator.api import dynamo
from orchestrator.resolvers import mots

from ._fake_dynamo import FakeTable


@pytest.fixture(autouse=True)
def _fake_table():
    dynamo.set_table(FakeTable())
    yield
    dynamo.set_table(None)


def _seed_mot(call_id, seq, **kw):
    item = {"PK": dynamo.pk_call(call_id), "SK": dynamo.sk_mot(seq), "turn_seq": seq}
    item.update(kw)
    dynamo.put_item(item)


def test_mots_new_shape_and_sorted():
    _seed_mot("c1", 5, markerId="MOT_1", state="ALERT", stage="OBJECTION")
    _seed_mot("c1", 2, motId="MOT_2", state="SHOW", stageIndex=0)
    out = mots.resolve_mots({}, {"callId": "c1"})
    assert [m["turnSeq"] for m in out] == [2, 5]
    # markerId/state/stage 포함
    m0 = out[0]
    assert m0["markerId"] == "MOT_2"
    assert m0["state"] == "SHOW"
    assert m0["stage"] == "TRUST"   # stageIndex 0 → TRUST


def test_mots_deprecated_fields_absent():
    _seed_mot("c1", 1, markerId="MOT_3", state="BLOCKED", stage="COLLATERAL",
              type="RISK", narrative="옛 서술", churn_before=40, churn_after=70)
    out = mots.resolve_mots({}, {"callId": "c1"})
    m = out[0]
    for dead in ("type", "narrative", "churnBefore", "churnAfter",
                 "triggers", "strategy", "outcome"):
        assert dead not in m


def test_mots_empty():
    assert mots.resolve_mots({}, {"callId": "none"}) == []
