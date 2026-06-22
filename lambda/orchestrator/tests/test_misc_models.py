"""DATA-006 (#6) — Summary·Product·ScenarioRun 모델 + crm_stages round-trip."""

from __future__ import annotations

import pytest

from orchestrator.api import dynamo
from orchestrator.models.product import Product
from orchestrator.models.scenario_run import ScenarioRun, sk_scenario
from orchestrator.models.summary import ResultType, Summary

from ._fake_dynamo import FakeTable


@pytest.fixture(autouse=True)
def _fake_table():
    dynamo.set_table(FakeTable())
    yield
    dynamo.set_table(None)


# -- Summary ------------------------------------------------------------------

def test_result_type_values():
    assert {r.value for r in ResultType} == {
        "한도조회_상담원연결", "가입승인", "거절"}


def test_summary_roundtrip_with_crm_stages():
    s = Summary(
        call_id="c1", result_type="가입승인", content="요약문",
        strategy_headline="대환 비교", strategy_lead="절감액 강조",
        crm_stages=[
            {"stage": "신뢰 쌓기", "text": "신원확인", "mots": ["rz-rate"]},
            {"stage": "우려 풀기", "text": "금리설명", "mots": ["rz-compare", "rz-pay"]},
            {"stage": "담보 오해", "text": "담보아님", "mots": ["rz-security"]},
            {"stage": "전환 맺기", "text": "링크발송", "mots": ["rz-avoid"]},
        ],
    )
    dynamo.put_item(s.to_item())
    got = Summary.from_item(dynamo.get_item(dynamo.pk_call("c1"), dynamo.SK_SUMMARY))
    assert got == s
    assert got.result_type is ResultType.APPROVED
    assert len(got.crm_stages) == 4
    assert got.crm_stages[1]["mots"] == ["rz-compare", "rz-pay"]


def test_summary_item_keys_match_resolver():
    item = Summary(call_id="c1", result_type="거절").to_item()
    for k in ("result_type", "strategy_headline", "strategy_lead", "crm_stages"):
        assert k in item


def test_summary_invalid_result_type():
    with pytest.raises(ValueError):
        Summary(call_id="c1", result_type="아무거나")


def test_summary_call_id_required():
    with pytest.raises(ValueError):
        Summary(call_id="")


# -- Product ------------------------------------------------------------------

def test_product_roundtrip():
    p = Product(id="p1", name="대환대출", rate="5.9%", limit=3000,
                description="갈아타기")
    dynamo.put_item(p.to_item())
    got = Product.from_item(dynamo.get_item(dynamo.pk_prod("p1"), dynamo.SK_META))
    assert got == p


def test_product_id_required():
    with pytest.raises(ValueError):
        Product(id="")


# -- ScenarioRun --------------------------------------------------------------

def test_scenario_run_roundtrip():
    r = ScenarioRun(call_id="c1", run_id="r1", scenario="S1",
                    outcome="가입승인")
    dynamo.put_item(r.to_item())
    got = ScenarioRun.from_item(
        dynamo.get_item(dynamo.pk_call("c1"), sk_scenario("r1")))
    assert got == r


def test_scenario_run_requires_ids():
    with pytest.raises(ValueError):
        ScenarioRun(call_id="c1", run_id="")
