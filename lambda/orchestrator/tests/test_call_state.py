"""DATA-002 (#2) — Call 모델 + CallState 전이 검증 + DynamoDB round-trip."""

from __future__ import annotations

import pytest

from orchestrator.api import dynamo
from orchestrator.models.call import Call, CallState, can_transition

from ._fake_dynamo import FakeTable


@pytest.fixture(autouse=True)
def _fake_table():
    dynamo.set_table(FakeTable())
    yield
    dynamo.set_table(None)


def test_call_state_has_eight_values():
    assert len(list(CallState)) == 8


def test_legal_transition_dialing_to_ringing():
    assert can_transition(CallState.DIALING, CallState.RINGING) is True
    assert can_transition("DIALING", "RINGING") is True


def test_illegal_transition_ended_to_in_call():
    assert can_transition(CallState.ENDED, CallState.IN_CALL) is False


def test_unknown_state_is_not_transitionable():
    assert can_transition("NOPE", "RINGING") is False


def test_transition_to_guards_illegal():
    c = Call(id="c1")
    assert c.state is CallState.DIALING
    c.transition_to(CallState.RINGING)
    assert c.state is CallState.RINGING
    with pytest.raises(ValueError):
        c.transition_to(CallState.ENDED)  # RINGING→ENDED 허용
        c.transition_to(CallState.IN_CALL)  # ENDED→IN_CALL 불법


def test_default_scenario_is_s1():
    assert Call(id="c1").scenario == "S1"


def test_id_required():
    with pytest.raises(ValueError):
        Call(id="")


def test_dynamo_roundtrip():
    c = Call(id="c1", customer_id="u1", state=CallState.IN_CALL,
             scenario="S1", started_at="2026-06-22T00:00:00Z")
    dynamo.put_item(c.to_item())
    got = Call.from_item(dynamo.get_item(dynamo.pk_call("c1"), dynamo.SK_META))
    assert got == c
    assert got.state is CallState.IN_CALL


def test_from_item_state_is_enum():
    c = Call(id="c1", state=CallState.WRAP_UP)
    got = Call.from_item(c.to_item())
    assert isinstance(got.state, CallState)
