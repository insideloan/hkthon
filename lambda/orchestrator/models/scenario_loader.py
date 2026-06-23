"""시나리오 로더 (DATA-008 / #8).

스크립트 모드 재생의 원천. S3에 올린 `scenario.json`(SSOT-3 구조)을 boto3 S3
GetObject로 읽어 파싱·스키마 검증한다. 검증은 SSOT-3 신규 필드(턴 레벨 `flag`,
`mot{marker_id,state,crm_stage}`, `compliance{draft,violated_policies,final,state}`,
`strategy_headline`/`strategy_lead`)까지 확인한다.

DATA-003(Turn.flag) / DATA-004(MOT) / DATA-005(ComplianceReview) / DATA-006(Summary
strategy) 모델과 enum 값이 정합한다.

⚠️ token `polarity`(PRO|CONS|null)는 키워드 색상용이 아니라 턴 레벨 `flag` 배지
분기 신호다(SSOT-3).

시나리오 종류:
  - s1 (대환): 이탈위험 5회(rz-*) 방어 → 상담원 전환. 18턴.
  - s2 (보이스피싱): 사기 의도 감지. MOT(이탈위험) 대신 턴 레벨 `fraud_suspected`
    플래그를 쓴다 — `agent/nodes.py:detect_fraud`/`fraud_suspected` 계약과 정합
    (사기 감지는 통화를 끊지 않고 대시보드 표시 전용). 15턴.

턴 수는 시나리오마다 다르다. JSON 최상위 `expected_turns`로 선언하면 그 값으로
검증하고, 없으면 하위호환을 위해 EXPECTED_TURNS(=18, S1)로 검증한다.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

# 번들된 로컬 시나리오 디렉토리 (repo-root/data/scenarios). 이 파일 기준
# models → orchestrator → lambda → repo root → data/scenarios.
_LOCAL_SCENARIO_DIR = Path(__file__).resolve().parents[3] / "data" / "scenarios"

# S3 오브젝트 키 규약: scenarios/{id}.json (config.py:scenario_key 기본 prefix와 정합).
_S3_KEY_PREFIX = "scenarios"

# 알려진 시나리오 ID (등록된 대화 스크립트). 신규 추가 시 여기 등록.
KNOWN_SCENARIOS = ("s1", "s2")

# SSOT-3 enum 허용값 (DATA-003/004/005 모델과 일치)
_SPEAKERS = {"bot", "customer", "agent"}
# 턴 node = AGENT 4단계 + 종료(agent/state.py:Stage). AGENT가 마지막 봇 Turn의
# node에서 stage를 역추론하므로(LANGGRAPH-DESIGN §4 _infer_stage) 값이 정합해야 한다.
# mot.py가 wire enum을 자체 상수로 두는 선례처럼, 모듈 결합을 피해 값만 복제.
_NODES = {"IDENTIFY", "CONSENT", "PROPOSE", "CHANNEL", "CLOSING"}
_FLAGS = {"risk", "def", None}
_POLARITIES = {"PRO", "CONS", None}
_MOT_MARKERS = {"rz-rate", "rz-compare", "rz-pay", "rz-security", "rz-avoid"}
_MOT_STATES = {"show", "alert", "blocked"}
_CRM_STAGES = {"신뢰 쌓기", "우려 풀기", "담보 오해", "전환 맺기"}
_COMPLIANCE_STATES = {"drafting", "reviewing", "redacting", "redrafting", "approved"}

EXPECTED_TURNS = 18


class ScenarioValidationError(ValueError):
    """시나리오 스키마 검증 실패."""


def load_from_s3(bucket: str, key: str, *, s3_client: Any = None) -> dict:
    """S3에서 scenario.json을 읽어 파싱·검증한 dict 반환.

    Args:
        bucket: S3 버킷명.
        key: 오브젝트 키 (예: "scenarios/scenario.json").
        s3_client: 주입용 boto3 S3 클라이언트(테스트). None이면 boto3 생성.
    """
    if s3_client is None:
        import boto3

        s3_client = boto3.client("s3")
    resp = s3_client.get_object(Bucket=bucket, Key=key)
    body = resp["Body"].read()
    if isinstance(body, bytes):
        body = body.decode("utf-8")
    data = json.loads(body)
    validate_scenario(data)
    return data


def load_from_str(raw: str) -> dict:
    """JSON 문자열을 파싱·검증 (로컬/번들 재생용)."""
    data = json.loads(raw)
    validate_scenario(data)
    return data


def s3_key_for(scenario_id: str) -> str:
    """시나리오 ID → S3 오브젝트 키 (scenarios/{id}.json)."""
    return f"{_S3_KEY_PREFIX}/{scenario_id}.json"


def _check_scenario_id(data: dict, scenario_id: str) -> dict:
    """로드한 데이터의 scenario_id가 요청한 ID와 일치하는지 확인."""
    actual = data.get("scenario_id")
    if actual != scenario_id:
        raise ScenarioValidationError(
            f"scenario_id mismatch: requested {scenario_id!r}, file has {actual!r}")
    return data


def load_scenario(scenario_id: str, *, bucket: str | None = None,
                  s3_client: Any = None) -> dict:
    """시나리오를 ID로 선택 로드·검증한다.

    `bucket`이 주어지면 S3 `scenarios/{id}.json`에서, 아니면 번들된 로컬
    `data/scenarios/{id}.json`에서 읽는다. 어느 경로든 로드한 파일의
    `scenario_id`가 요청한 ID와 일치하는지 검증한다.

    Args:
        scenario_id: 시나리오 식별자 (예: "s1", "s2").
        bucket: S3 버킷명. None이면 로컬 번들에서 로드.
        s3_client: 주입용 boto3 S3 클라이언트(테스트).
    """
    if bucket is not None:
        data = load_from_s3(bucket, s3_key_for(scenario_id), s3_client=s3_client)
        return _check_scenario_id(data, scenario_id)

    path = _LOCAL_SCENARIO_DIR / f"{scenario_id}.json"
    if not path.exists():
        raise ScenarioValidationError(
            f"unknown scenario {scenario_id!r}: {path} not found")
    data = load_from_str(path.read_text(encoding="utf-8"))
    return _check_scenario_id(data, scenario_id)


def validate_scenario(data: dict, *, expected_turns: int | None = None) -> dict:
    """시나리오 스키마 검증. 실패 시 ScenarioValidationError.

    검증 항목:
      - turns 수: expected_turns(인자) > data['expected_turns'](JSON 선언) >
        EXPECTED_TURNS(=18, 하위호환) 순으로 결정, seq 0..n 순서
      - speaker bot/customer 교대(연속 같은 화자 bot은 허용 — AI 연속 안내 가능)
      - 각 턴 필수 필드(speaker/text/tokens/churn_after/node/flag)
      - flag/polarity/mot/compliance/strategy enum 유효성 + fraud_suspected(bool)
    """
    if not isinstance(data, dict):
        raise ScenarioValidationError("scenario must be a JSON object")
    turns = data.get("turns")
    if not isinstance(turns, list):
        raise ScenarioValidationError("scenario.turns must be a list")
    # 턴 수 기대값: 명시 인자 > JSON 선언 > 기본(18). JSON 선언은 정수여야 함.
    if expected_turns is None:
        declared = data.get("expected_turns", EXPECTED_TURNS)
        if not isinstance(declared, int) or isinstance(declared, bool):
            raise ScenarioValidationError(
                f"scenario.expected_turns must be an int, got {declared!r}")
        expected_turns = declared
    if len(turns) != expected_turns:
        raise ScenarioValidationError(
            f"expected {expected_turns} turns, got {len(turns)}")

    prev_customer: Optional[bool] = None
    for i, turn in enumerate(turns):
        _validate_turn(turn, i)
        # cust/ai 교대 검증: 고객 턴은 연속되지 않아야 함(고객→고객 금지).
        is_customer = turn["speaker"] == "customer"
        if is_customer and prev_customer:
            raise ScenarioValidationError(
                f"turn {i}: two customer turns in a row (교대 순서 위반)")
        prev_customer = is_customer
    return data


def _validate_turn(turn: dict, index: int) -> None:
    if not isinstance(turn, dict):
        raise ScenarioValidationError(f"turn {index} must be an object")

    # 필수 필드
    for field in ("speaker", "text", "tokens", "churn_after", "node", "flag"):
        if field not in turn:
            raise ScenarioValidationError(f"turn {index}: missing field '{field}'")

    # seq 순서
    if turn.get("seq") != index:
        raise ScenarioValidationError(
            f"turn {index}: seq mismatch (got {turn.get('seq')})")

    if turn["speaker"] not in _SPEAKERS:
        raise ScenarioValidationError(
            f"turn {index}: invalid speaker {turn['speaker']!r}")
    if turn["node"] not in _NODES:
        raise ScenarioValidationError(
            f"turn {index}: invalid node {turn['node']!r} "
            f"(Stage: IDENTIFY|CONSENT|PROPOSE|CHANNEL|CLOSING)")
    if turn["flag"] not in _FLAGS:
        raise ScenarioValidationError(
            f"turn {index}: invalid flag {turn['flag']!r} (risk|def|null)")

    # tokens
    if not isinstance(turn["tokens"], list):
        raise ScenarioValidationError(f"turn {index}: tokens must be a list")
    for j, tok in enumerate(turn["tokens"]):
        if "text" not in tok:
            raise ScenarioValidationError(
                f"turn {index} token {j}: missing 'text'")
        if tok.get("polarity") not in _POLARITIES:
            raise ScenarioValidationError(
                f"turn {index} token {j}: invalid polarity {tok.get('polarity')!r}")

    # fraud_suspected (선택) — 사기 의심 시나리오(s2)용 턴 레벨 플래그.
    # agent/nodes.py:detect_fraud 계약과 정합(통화 종료·라우팅 영향 없음, 표시 전용).
    if "fraud_suspected" in turn and not isinstance(turn["fraud_suspected"], bool):
        raise ScenarioValidationError(
            f"turn {index}: fraud_suspected must be a boolean")

    # greet (선택) — 아웃바운드 발신 시 고객이 먼저 받는 인사 턴("여보세요?").
    # 분석/MOT 파이프라인을 트리거하지 않는 가벼운 턴(프론트 consult-engine 계약).
    if "greet" in turn and not isinstance(turn["greet"], bool):
        raise ScenarioValidationError(
            f"turn {index}: greet must be a boolean")

    # mot (선택) — 있으면 enum 검증
    if "mot" in turn:
        _validate_mot(turn["mot"], index)

    # compliance (선택)
    if "compliance" in turn:
        _validate_compliance(turn["compliance"], index)

    # strategy_headline/lead는 쌍으로 존재(있으면 둘 다 str)
    if "strategy_headline" in turn or "strategy_lead" in turn:
        for f in ("strategy_headline", "strategy_lead"):
            if not isinstance(turn.get(f), str):
                raise ScenarioValidationError(
                    f"turn {index}: '{f}' must be a string when strategy present")


def _validate_mot(mot: dict, index: int) -> None:
    if mot.get("marker_id") not in _MOT_MARKERS:
        raise ScenarioValidationError(
            f"turn {index}: invalid mot.marker_id {mot.get('marker_id')!r}")
    if mot.get("state") not in _MOT_STATES:
        raise ScenarioValidationError(
            f"turn {index}: invalid mot.state {mot.get('state')!r}")
    if mot.get("crm_stage") not in _CRM_STAGES:
        raise ScenarioValidationError(
            f"turn {index}: invalid mot.crm_stage {mot.get('crm_stage')!r}")


def _validate_compliance(comp: dict, index: int) -> None:
    for f in ("draft", "violated_policies", "final", "state"):
        if f not in comp:
            raise ScenarioValidationError(
                f"turn {index}: compliance missing '{f}'")
    if comp["state"] not in _COMPLIANCE_STATES:
        raise ScenarioValidationError(
            f"turn {index}: invalid compliance.state {comp['state']!r}")
    if not isinstance(comp["violated_policies"], list):
        raise ScenarioValidationError(
            f"turn {index}: compliance.violated_policies must be a list")
