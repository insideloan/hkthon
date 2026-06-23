"""DATA-008 (#8) — S1 시나리오 로드 + 스키마 검증 + S3 GetObject."""

from __future__ import annotations

import copy
import io
import json
from pathlib import Path

import pytest

from orchestrator.models import scenario_loader as sl

# 리포지토리의 실제 시나리오 파일 (tests → orchestrator → lambda → repo root → data/)
_SCENARIO_DIR = Path(__file__).resolve().parents[3] / "data" / "scenarios"
_S1_PATH = _SCENARIO_DIR / "s1.json"
_S2_PATH = _SCENARIO_DIR / "s2.json"


@pytest.fixture(scope="module")
def s1_raw() -> str:
    return _S1_PATH.read_text(encoding="utf-8")


@pytest.fixture
def s1_data(s1_raw) -> dict:
    return json.loads(s1_raw)


@pytest.fixture(scope="module")
def s2_raw() -> str:
    return _S2_PATH.read_text(encoding="utf-8")


@pytest.fixture
def s2_data(s2_raw) -> dict:
    return json.loads(s2_raw)


# -- 실제 s1.json 로드/검증 ----------------------------------------------------

def test_s1_file_exists():
    assert _S1_PATH.exists(), f"missing {_S1_PATH}"


def test_s1_loads_19_turns(s1_raw):
    # 아웃바운드 인사("여보세요?") greet 턴 추가로 19턴. expected_turns 선언으로
    # 18턴 기본값을 오버라이드(S2의 15턴 방식과 동일).
    data = sl.load_from_str(s1_raw)
    assert data["expected_turns"] == 19
    assert len(data["turns"]) == 19


def test_s1_opens_with_customer_greet(s1_data):
    # 아웃바운드: 연결 시 고객이 먼저 "여보세요?". 분석/MOT 트리거 안 함.
    first = s1_data["turns"][0]
    assert first["speaker"] == "customer"
    assert first.get("greet") is True
    assert "mot" not in first
    # 두 번째 턴이 봇 인사.
    assert s1_data["turns"][1]["speaker"] == "bot"
    assert "현대캐피탈" in s1_data["turns"][1]["text"]


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
    with pytest.raises(sl.ScenarioValidationError, match="18"):
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
    # turns[2]=customer(이미), turns[3]=bot → turns[3]을 customer로 바꿔 연속 위반.
    bad["turns"][3]["speaker"] = "customer"  # seq 2,3 모두 customer
    with pytest.raises(sl.ScenarioValidationError, match="교대"):
        sl.validate_scenario(bad)


# -- S2 (보이스피싱) — 가변 턴 수 + fraud_suspected ----------------------------

def test_s2_file_exists():
    assert _S2_PATH.exists(), f"missing {_S2_PATH}"


def test_s2_loads_16_turns_via_declared_count(s2_raw):
    # JSON 최상위 expected_turns=16 선언으로 18턴 기본값을 오버라이드해야 함.
    # (인사 greet 턴 1 + 대화 15)
    data = sl.load_from_str(s2_raw)
    assert data["expected_turns"] == 16
    assert len(data["turns"]) == 16


def test_s2_passes_schema_validation(s2_data):
    assert sl.validate_scenario(s2_data) is s2_data


def test_s2_starts_with_greet_turn(s2_data):
    # 아웃바운드 발신 — 고객이 먼저 "여보세요?"로 받는 인사 턴으로 시작(s1과 정합).
    first = s2_data["turns"][0]
    assert first["greet"] is True
    assert first["speaker"] == "customer"
    # 인사 턴은 분석/사기 파이프라인을 트리거하지 않는다(tokens 비고 fraud 없음).
    assert first["tokens"] == []
    assert "fraud_suspected" not in first


def test_invalid_greet_type_detected(s2_data):
    bad = copy.deepcopy(s2_data)
    bad["turns"][0]["greet"] = "yes"
    with pytest.raises(sl.ScenarioValidationError, match="greet"):
        sl.validate_scenario(bad)


def test_s2_uses_fraud_flag_not_mot(s2_data):
    # 보이스피싱은 MOT(이탈위험) 대신 fraud_suspected 플래그를 쓴다.
    assert all("mot" not in t for t in s2_data["turns"])
    fraud_turns = [t["seq"] for t in s2_data["turns"] if t.get("fraud_suspected")]
    assert fraud_turns, "사기 의심 턴이 있어야 함"
    # 봇이 의심을 인지한 시점부터 접수까지 연속 true.
    assert fraud_turns == list(range(fraud_turns[0], fraud_turns[-1] + 1))


def test_s2_customer_turns_not_consecutive(s2_data):
    speakers = [t["speaker"] for t in s2_data["turns"]]
    for a, b in zip(speakers, speakers[1:]):
        assert not (a == "customer" and b == "customer")


def test_invalid_fraud_suspected_type_detected(s2_data):
    bad = copy.deepcopy(s2_data)
    next(t for t in bad["turns"] if "fraud_suspected" in t)["fraud_suspected"] = "yes"
    with pytest.raises(sl.ScenarioValidationError, match="fraud_suspected"):
        sl.validate_scenario(bad)


def test_non_int_expected_turns_rejected(s2_data):
    bad = copy.deepcopy(s2_data)
    bad["expected_turns"] = "15"
    with pytest.raises(sl.ScenarioValidationError, match="expected_turns"):
        sl.validate_scenario(bad)


def test_explicit_expected_turns_arg_overrides_declared(s2_data):
    # 명시 인자가 JSON 선언보다 우선 — 15개 턴인데 14를 강제하면 실패해야 함.
    with pytest.raises(sl.ScenarioValidationError, match="14"):
        sl.validate_scenario(s2_data, expected_turns=14)


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
    assert len(data["turns"]) == 19
    assert fake.calls == [("assets-bucket", "scenarios/scenario.json")]


def test_load_from_s3_validates(s1_data):
    bad = copy.deepcopy(s1_data)
    del bad["turns"][0]["text"]
    fake = _FakeS3(json.dumps(bad))
    with pytest.raises(sl.ScenarioValidationError):
        sl.load_from_s3("b", "k", s3_client=fake)


# -- 시나리오 ID 기반 선택 로드 ------------------------------------------------

def test_s3_key_for():
    assert sl.s3_key_for("s1") == "scenarios/s1.json"
    assert sl.s3_key_for("s2") == "scenarios/s2.json"


def test_load_scenario_local_known_ids():
    # 번들된 로컬 파일에서 ID로 로드 (bucket 미지정).
    for sid, turns in (("s1", 19), ("s2", 16)):
        data = sl.load_scenario(sid)
        assert data["scenario_id"] == sid
        assert len(data["turns"]) == turns


def test_load_scenario_unknown_id_raises():
    with pytest.raises(sl.ScenarioValidationError, match="unknown scenario"):
        sl.load_scenario("does-not-exist")


def test_load_scenario_from_s3(s2_raw):
    fake = _FakeS3(s2_raw)
    data = sl.load_scenario("s2", bucket="assets-bucket", s3_client=fake)
    assert data["scenario_id"] == "s2"
    # ID 규약대로 scenarios/s2.json 키를 요청해야 함.
    assert fake.calls == [("assets-bucket", "scenarios/s2.json")]


def test_load_scenario_id_mismatch_detected(s1_raw):
    # s1 내용을 s2로 요청 → scenario_id 불일치 검출.
    fake = _FakeS3(s1_raw)
    with pytest.raises(sl.ScenarioValidationError, match="scenario_id mismatch"):
        sl.load_scenario("s2", bucket="b", s3_client=fake)


def test_known_scenarios_all_loadable():
    # KNOWN_SCENARIOS에 등록된 ID는 전부 로컬에서 로드 가능해야 함.
    for sid in sl.KNOWN_SCENARIOS:
        assert sl.load_scenario(sid)["scenario_id"] == sid
