"""DATA-003 (#3) — Turn 모델: speaker/polarity/flag + tokens Map round-trip."""

from __future__ import annotations

import pytest

from orchestrator.api import dynamo
from orchestrator.models.turn import Speaker, Turn

from ._fake_dynamo import FakeTable


@pytest.fixture(autouse=True)
def _fake_table():
    dynamo.set_table(FakeTable())
    yield
    dynamo.set_table(None)


def test_speaker_enum_validates():
    assert Turn(call_id="c1", seq=1, speaker="customer").speaker is Speaker.CUSTOMER
    with pytest.raises(ValueError):
        Turn(call_id="c1", seq=1, speaker="robot")


def test_flag_validation():
    for f in ("risk", "def", None):
        assert Turn(call_id="c1", seq=1, flag=f).flag == f
    with pytest.raises(ValueError):
        Turn(call_id="c1", seq=1, flag="warning")


def test_polarity_null_allowed():
    t = Turn(call_id="c1", seq=1, tokens=[{"text": "금리"}])
    assert t.tokens[0]["polarity"] is None
    assert t.tokens[0]["reason"] == ""


def test_invalid_polarity_rejected():
    with pytest.raises(ValueError):
        Turn(call_id="c1", seq=1, tokens=[{"text": "x", "polarity": "MAYBE"}])


def test_neutral_polarity_normalized_to_null():
    # "NEUTRAL"/"" 은 중립의 별칭 → null로 관용 정규화(persist가 ValueError로 죽지 않게).
    # exp_presets가 토큰에 "NEUTRAL"을 쓰던 회귀를 방어한다.
    t = Turn(call_id="c1", seq=1, tokens=[
        {"text": "금리가 몇 퍼센트", "polarity": "NEUTRAL", "reason": "조건 질문"},
        {"text": "음", "polarity": "", "reason": ""},
    ])
    assert t.tokens[0]["polarity"] is None
    assert t.tokens[1]["polarity"] is None


def test_tokens_map_roundtrip():
    t = Turn(call_id="c1", seq=2, speaker="customer", text="금리가 높네요",
             node="classify", churn_after=0.7, flag="risk",
             tokens=[{"text": "금리", "polarity": "CONS", "reason": "부담"},
                     {"text": "가입", "polarity": "PRO", "reason": "관심"}])
    dynamo.put_item(t.to_item())
    got = Turn.from_item(dynamo.get_item(dynamo.pk_call("c1"), dynamo.sk_turn(2)))
    assert got == t
    assert got.tokens[0] == {"text": "금리", "polarity": "CONS", "reason": "부담"}
    assert got.flag == "risk"
    assert got.speaker is Speaker.CUSTOMER


def test_seq_recovered_from_sk_when_missing():
    t = Turn(call_id="c1", seq=5)
    item = t.to_item()
    del item["seq"]
    got = Turn.from_item(item)
    assert got.seq == 5


def test_call_id_required():
    with pytest.raises(ValueError):
        Turn(call_id="", seq=1)
