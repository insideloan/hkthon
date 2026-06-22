"""DATA-005 (#5) — ComplianceReview 모델: state 전이 + SK + 직렬화 round-trip."""

from __future__ import annotations

import pytest

from orchestrator.api import dynamo
from orchestrator.models.compliance import (
    ComplianceReview,
    ComplianceState,
    can_transition,
    sk,
)

from ._fake_dynamo import FakeTable


@pytest.fixture(autouse=True)
def _fake_table():
    dynamo.set_table(FakeTable())
    yield
    dynamo.set_table(None)


def test_state_enum_five_values():
    assert {s.value for s in ComplianceState} == {
        "drafting", "reviewing", "redacting", "redrafting", "approved"}


def test_state_forward_transition_order():
    seq = ["drafting", "reviewing", "redacting", "redrafting", "approved"]
    for a, b in zip(seq, seq[1:]):
        assert can_transition(a, b) is True
    # 역방향/동일 단계는 불허
    assert can_transition("approved", "drafting") is False
    assert can_transition("reviewing", "reviewing") is False
    assert can_transition("bogus", "approved") is False


def test_sk_format():
    assert sk(3, 1) == "CMPL#3#1"


def test_three_stage_fields_present():
    r = ComplianceReview(call_id="c1", turn=2, try_index=0,
                         draft="가안 발화",
                         violated_policies=["과장광고", "원금보장오인"],
                         final="수정된 최종 발화")
    item = r.to_item()
    for k in ("draft", "violated_policies", "final"):
        assert k in item
    assert item["SK"] == "CMPL#2#0"


def test_violated_policies_list_roundtrip():
    r = ComplianceReview(call_id="c1", turn=4, try_index=1,
                         state=ComplianceState.REVIEWING,
                         draft="d", violated_policies=["p1", "p2", "p3"],
                         final="")
    dynamo.put_item(r.to_item())
    got = ComplianceReview.from_item(
        dynamo.get_item(dynamo.pk_call("c1"), sk(4, 1)))
    assert got == r
    assert got.violated_policies == ["p1", "p2", "p3"]
    assert got.state is ComplianceState.REVIEWING


def test_call_id_required():
    with pytest.raises(ValueError):
        ComplianceReview(call_id="", turn=1, try_index=0)
