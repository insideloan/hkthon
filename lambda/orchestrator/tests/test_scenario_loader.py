"""DATA-008 (#8) — S1 시나리오 로드 + 스키마 검증 + S3 GetObject."""

from __future__ import annotations

import copy
import io
import json
from pathlib import Path

import pytest

from orchestrator.models import scenario_loader as sl

# 리포지토리의 실제 시나리오 파일 (tests → orchestrator → lambda → repo root → data/)
_S1_PATH = Path(__file__).resolve().parents[3] / "data" / "scenarios" / "s1.json"


@pytest.fixture(scope="module")
def s1_raw() -> str:
    return _S1_PATH.read_text(encoding="utf-8")


@pytest.fixture
def s1_data(s1_raw) -> dict:
    return json.loads(s1_raw)


# -- 실제 s1.json 로드/검증 ----------------------------------------------------

def test_s1_file_exists():
    assert _S1_PATH.exists(), f"missing {_S1_PATH}"


def test_s1_loads_18_turns(s1_raw):
    data = sl.load_from_str(s1_raw)
    assert len(data["turns"]) == sl.EXPECTED_TURNS == 18


def test_s1_passes_schema_validation(s1_data):
    # 실제 시나리오가 전체 스키마를 통과해야 함
    assert sl.validate_scenario(s1_data) is s1_data


def test_s1_has_five_mot_markers(s1_data):
    markers = [t["mot"]["marker_id"] for t in s1_data["turns"] if "mot" in t]
    assert set(markers) == {"rz-rate", "rz-compare", "rz-pay",
                            "rz-security", "rz-avoid"}


def test_s1_flag_values_valid(s1_data):
    for t in s1_data["turns"]:
        assert t["flag"] in {"risk", "def", None}


def test_s1_compliance_states_valid(s1_data):
    comps = [t["compliance"] for t in s1_data["turns"] if "compliance" in t]
    assert comps, "시나리오에 compliance 턴이 있어야 함"
    for c in comps:
        assert c["state"] in sl._COMPLIANCE_STATES
        assert isinstance(c["violated_policies"], list)


def test_s1_strategy_fields_present(s1_data):
    strat = [t for t in s1_data["turns"] if "strategy_headline" in t]
    assert strat
    for t in strat:
        assert isinstance(t["strategy_headline"], str)
        assert isinstance(t["strategy_lead"], str)


# -- cust/ai 교대 순서 ---------------------------------------------------------

def test_customer_turns_not_consecutive(s1_data):
    speakers = [t["speaker"] for t in s1_data["turns"]]
    for a, b in zip(speakers, speakers[1:]):
        assert not (a == "customer" and b == "customer")


# -- 누락 필드 탐지 ------------------------------------------------------------

def test_missing_required_field_detected(s1_data):
    bad = copy.deepcopy(s1_data)
    del bad["turns"][0]["flag"]
    with pytest.raises(sl.ScenarioValidationError, match="flag"):
        sl.validate_scenario(bad)


def test_wrong_turn_count_detected(s1_data):
    bad = copy.deepcopy(s1_data)
    bad["turns"].pop()
    with pytest.raises(sl.ScenarioValidationError, match="17"):
        sl.validate_scenario(bad)


def test_invalid_mot_marker_detected(s1_data):
    bad = copy.deepcopy(s1_data)
    next(t for t in bad["turns"] if "mot" in t)["mot"]["marker_id"] = "rz-nope"
    with pytest.raises(sl.ScenarioValidationError, match="marker_id"):
        sl.validate_scenario(bad)


def test_invalid_compliance_state_detected(s1_data):
    bad = copy.deepcopy(s1_data)
    next(t for t in bad["turns"] if "compliance" in t)["compliance"]["state"] = "bogus"
    with pytest.raises(sl.ScenarioValidationError, match="compliance.state"):
        sl.validate_scenario(bad)


def test_consecutive_customer_turns_detected(s1_data):
    bad = copy.deepcopy(s1_data)
    bad["turns"][2]["speaker"] = "customer"  # seq 1,2 모두 customer
    with pytest.raises(sl.ScenarioValidationError, match="교대"):
        sl.validate_scenario(bad)


# -- S3 GetObject 경로 ---------------------------------------------------------

class _FakeS3:
    """boto3 S3 client.get_object 흉내 (no moto)."""

    def __init__(self, payload: str):
        self._payload = payload.encode("utf-8")
        self.calls = []

    def get_object(self, Bucket, Key):  # noqa: N803 (boto3 kw)
        self.calls.append((Bucket, Key))
        return {"Body": io.BytesIO(self._payload)}


def test_load_from_s3_getobject(s1_raw):
    fake = _FakeS3(s1_raw)
    data = sl.load_from_s3("assets-bucket", "scenarios/scenario.json",
                           s3_client=fake)
    assert len(data["turns"]) == 18
    assert fake.calls == [("assets-bucket", "scenarios/scenario.json")]


def test_load_from_s3_validates(s1_data):
    bad = copy.deepcopy(s1_data)
    del bad["turns"][0]["text"]
    fake = _FakeS3(json.dumps(bad))
    with pytest.raises(sl.ScenarioValidationError):
        sl.load_from_s3("b", "k", s3_client=fake)
