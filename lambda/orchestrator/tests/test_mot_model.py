"""DATA-004 (#4) — MOT 모델: enum 검증 + wire-canonical 마샬링 round-trip."""

from __future__ import annotations

import pytest

from orchestrator.api import dynamo
from orchestrator.models.mot import MOT
from orchestrator.resolvers import mots

from ._fake_dynamo import FakeTable


@pytest.fixture(autouse=True)
def _fake_table():
    dynamo.set_table(FakeTable())
    yield
    dynamo.set_table(None)


def _mot(**kw):
    base = dict(call_id="c1", seq=1, marker_id="rz-rate", state="show",
                crm_stage="신뢰 쌓기", turn_seq=1)
    base.update(kw)
    return MOT(**base)


def test_marker_id_enum():
    for m in ("rz-rate", "rz-compare", "rz-pay", "rz-security", "rz-avoid"):
        assert _mot(marker_id=m).marker_id == m
    with pytest.raises(ValueError):
        _mot(marker_id="rz-nope")


def test_state_enum():
    for s in ("show", "alert", "blocked"):
        assert _mot(state=s).state == s
    with pytest.raises(ValueError):
        _mot(state="warning")


def test_crm_stage_enum():
    for st in ("신뢰 쌓기", "우려 풀기", "담보 오해", "전환 맺기"):
        assert _mot(crm_stage=st).crm_stage == st
    with pytest.raises(ValueError):
        _mot(crm_stage="아무거나")


def test_marker_label():
    assert _mot(marker_id="rz-security").marker_label == "MOT_4"


def test_to_item_is_wire_canonical():
    item = _mot(marker_id="rz-compare", state="alert",
                crm_stage="우려 풀기", turn_seq=3).to_item()
    assert item["markerId"] == "MOT_2"
    assert item["state"] == "ALERT"
    assert item["stage"] == "OBJECTION"
    # 폐기 필드 부재
    for dead in ("type", "narrative", "churn_before", "churn_after",
                 "triggers", "strategy", "outcome"):
        assert dead not in item


def test_dynamo_roundtrip():
    m = _mot(marker_id="rz-pay", state="blocked", crm_stage="담보 오해", turn_seq=7)
    dynamo.put_item(m.to_item())
    got = MOT.from_item(dynamo.get_item(dynamo.pk_call("c1"), dynamo.sk_mot(1)))
    assert got == m


def test_compatible_with_mots_resolver():
    """모델이 저장한 아이템을 기존 mot_out resolver가 그대로 읽을 수 있어야 함."""
    dynamo.put_item(_mot(marker_id="rz-rate", state="show",
                         crm_stage="신뢰 쌓기", turn_seq=2).to_item())
    out = mots.resolve_mots({}, {"callId": "c1"})
    assert out[0]["markerId"] == "MOT_1"
    assert out[0]["state"] == "SHOW"
    assert out[0]["stage"] == "TRUST"
    assert out[0]["turnSeq"] == 2
