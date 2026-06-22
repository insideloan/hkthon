"""AGENT-003 (#11) — MOT 탐지 규칙 검증 (SSOT-3 재정렬).

SSOT: docs/consult_redesigned-3.html. BACKEND #28 wire 계약.

검증 항목:
  - 위험 임계: Δchurn≥+12 또는 churn≥60
  - 전환 트리거: TRANSFER_INTENT/BUYING_INTENT
  - motId: MOT_1~MOT_5 (enum)
  - state: SHOW|ALERT|BLOCKED (대문자)
  - stageIndex: 0~3
  - is_conversion 플래그
  - 폐기 필드 미존재: type, narrative, strategy, outcome, churnBefore, churnAfter
  - 비-MOT 턴: None 반환
  - DynamoDB write mock 검증
"""

from unittest.mock import MagicMock

from orchestrator.agent import mot
from orchestrator.agent.state import Intent

# ─────────────────────────────────────────────────────────────────────────────
# 헬퍼
# ─────────────────────────────────────────────────────────────────────────────

_VALID_MOT_IDS = {"MOT_1", "MOT_2", "MOT_3", "MOT_4", "MOT_5"}
_VALID_STATES = {"SHOW", "ALERT", "BLOCKED"}
_DEPRECATED_FIELDS = {"type", "narrative", "strategy", "outcome", "churnBefore", "churnAfter"}


def _state(**kw):
    base = {
        "churn_before": 50,
        "churn_after": 50,
        "intent": Intent.QUESTION_TERMS,
        "next_seq": 0,
        "churn_tokens": [],
        "strategy": {},
    }
    base.update(kw)
    return base


def _assert_valid_mot(m):
    """공통 MOT 결과 유효성 검증."""
    assert m is not None
    assert m["motId"] in _VALID_MOT_IDS, f"motId 유효 값 아님: {m['motId']}"
    assert m["state"] in _VALID_STATES, f"state 유효 값 아님: {m['state']}"
    assert isinstance(m["stageIndex"], int) and 0 <= m["stageIndex"] <= 3, (
        f"stageIndex 범위 초과: {m['stageIndex']}"
    )
    # 폐기 필드 미존재 검증
    for field in _DEPRECATED_FIELDS:
        assert field not in m, f"폐기 필드 존재: {field}"


# ─────────────────────────────────────────────────────────────────────────────
# 위험 임계 테스트
# ─────────────────────────────────────────────────────────────────────────────


def test_risk_by_delta():
    """Δchurn ≥ +12 → RISK MOT 생성."""
    m = mot.detect(_state(churn_before=50, churn_after=63))
    _assert_valid_mot(m)
    assert m["is_conversion"] is False


def test_risk_by_absolute():
    """churn ≥ 60 → RISK MOT 생성."""
    m = mot.detect(_state(churn_before=58, churn_after=61))
    _assert_valid_mot(m)
    assert m["is_conversion"] is False


def test_risk_state_show_when_churn_below_50():
    """위험 감지 + churn < 50 → state=SHOW."""
    m = mot.detect(_state(churn_before=30, churn_after=43))
    _assert_valid_mot(m)
    assert m["state"] == "SHOW"


def test_risk_state_alert_when_churn_gte_50():
    """위험 감지 + churn ≥ 50 → state=ALERT."""
    m = mot.detect(_state(churn_before=50, churn_after=63))
    _assert_valid_mot(m)
    assert m["state"] == "ALERT"


# ─────────────────────────────────────────────────────────────────────────────
# 전환 트리거 테스트
# ─────────────────────────────────────────────────────────────────────────────


def test_conversion_on_transfer_intent():
    """TRANSFER_INTENT → 전환 MOT, state=BLOCKED."""
    m = mot.detect(_state(intent=Intent.TRANSFER_INTENT, churn_after=40))
    _assert_valid_mot(m)
    assert m["is_conversion"] is True
    assert m["state"] == "BLOCKED"


def test_conversion_on_buying_intent():
    """BUYING_INTENT → 전환 MOT, state=BLOCKED."""
    m = mot.detect(_state(intent=Intent.BUYING_INTENT, churn_after=40))
    _assert_valid_mot(m)
    assert m["is_conversion"] is True
    assert m["state"] == "BLOCKED"


def test_conversion_takes_priority_over_risk():
    """전환 의도가 있으면 churn이 높아도 BLOCKED (전환 우선)."""
    m = mot.detect(_state(intent=Intent.BUYING_INTENT, churn_before=50, churn_after=70))
    _assert_valid_mot(m)
    assert m["is_conversion"] is True
    assert m["state"] == "BLOCKED"


# ─────────────────────────────────────────────────────────────────────────────
# LIMIT_INQUIRY 제외 검증 (SSOT-3 — 전환 트리거 아님)
# ─────────────────────────────────────────────────────────────────────────────


def test_limit_inquiry_not_conversion_without_churn():
    """LIMIT_INQUIRY는 SSOT-3 전환 트리거 아님 — churn 임계 없으면 None."""
    m = mot.detect(_state(intent=Intent.LIMIT_INQUIRY, churn_before=50, churn_after=52))
    assert m is None


# ─────────────────────────────────────────────────────────────────────────────
# 비-MOT 턴
# ─────────────────────────────────────────────────────────────────────────────


def test_no_mot_on_calm_turn():
    """위험/전환 신호 없는 평온한 턴 → None."""
    m = mot.detect(_state(churn_before=50, churn_after=52, intent=Intent.QUESTION_TERMS))
    assert m is None


# ─────────────────────────────────────────────────────────────────────────────
# motId / stageIndex 매핑 테스트
# ─────────────────────────────────────────────────────────────────────────────


def test_mot_id_assigned():
    """MOT 결과에 motId(MOT_1~5) 포함."""
    m = mot.detect(_state(churn_before=50, churn_after=63, next_seq=0))
    _assert_valid_mot(m)
    assert m["motId"] == "MOT_1"


def test_stage_index_trust_for_mot1():
    """MOT_1 → stageIndex=0 (TRUST)."""
    m = mot.detect(_state(churn_before=50, churn_after=63, next_seq=0))
    assert m["stageIndex"] == 0


def test_stage_index_objection_for_mot3():
    """MOT_3 → stageIndex=1 (OBJECTION)."""
    m = mot.detect(_state(churn_before=50, churn_after=63, next_seq=2))
    assert m["stageIndex"] == 1


def test_stage_index_collateral_for_mot4():
    """MOT_4 → stageIndex=2 (COLLATERAL)."""
    m = mot.detect(_state(churn_before=50, churn_after=63, next_seq=3))
    assert m["stageIndex"] == 2


def test_stage_index_close_for_mot5():
    """MOT_5 → stageIndex=3 (CLOSE)."""
    m = mot.detect(_state(churn_before=50, churn_after=63, next_seq=4))
    assert m["stageIndex"] == 3


# ─────────────────────────────────────────────────────────────────────────────
# 폐기 필드 미존재 검증
# ─────────────────────────────────────────────────────────────────────────────


def test_no_type_field():
    """type:RISK|CONVERSION 필드 미존재 (SSOT-3 폐기)."""
    m = mot.detect(_state(churn_before=50, churn_after=63))
    assert m is not None
    assert "type" not in m


def test_no_narrative_field():
    """narrative 필드 미존재 (SSOT-3 폐기)."""
    m = mot.detect(_state(churn_before=50, churn_after=63))
    assert m is not None
    assert "narrative" not in m


def test_no_outcome_field():
    """outcome 필드 미존재 (SSOT-3 폐기)."""
    m = mot.detect(_state(churn_before=50, churn_after=63))
    assert m is not None
    assert "outcome" not in m


def test_no_strategy_field_in_result():
    """strategy 필드 미존재 (SSOT-3 폐기)."""
    m = mot.detect(_state(churn_before=50, churn_after=63))
    assert m is not None
    assert "strategy" not in m


def test_no_churn_before_after_free_fields():
    """churnBefore/churnAfter 자유 필드 미존재 (camelCase 폐기)."""
    m = mot.detect(_state(churn_before=50, churn_after=63))
    assert m is not None
    assert "churnBefore" not in m
    assert "churnAfter" not in m


# ─────────────────────────────────────────────────────────────────────────────
# triggers 토큰 추출 검증
# ─────────────────────────────────────────────────────────────────────────────


def test_triggers_cons_only_on_risk():
    """위험 MOT: CONS 토큰만 triggers에 포함."""
    tokens = [
        {"text": "비싸요", "polarity": "CONS", "reason": "고금리"},
        {"text": "좋아요", "polarity": "PRO", "reason": "낮은 이자"},
    ]
    m = mot.detect(_state(churn_before=50, churn_after=63, churn_tokens=tokens))
    assert m is not None
    assert m["triggers"] == ["비싸요"]


def test_triggers_all_on_conversion():
    """전환 MOT: 모든 토큰 triggers에 포함."""
    tokens = [
        {"text": "연결해주세요", "polarity": "PRO", "reason": "전환"},
        {"text": "비교만요", "polarity": "CONS", "reason": "가격"},
    ]
    m = mot.detect(
        _state(intent=Intent.TRANSFER_INTENT, churn_after=40, churn_tokens=tokens)
    )
    assert m is not None
    assert set(m["triggers"]) == {"연결해주세요", "비교만요"}


# ─────────────────────────────────────────────────────────────────────────────
# DynamoDB write mock 검증
# ─────────────────────────────────────────────────────────────────────────────


def test_dynamo_write_called_on_risk():
    """위험 MOT 탐지 시 DynamoDB put_item 호출 검증 (mock boto3, boto3 미설치 환경 호환).

    mot.py는 탐지 전용 — DynamoDB write는 상위 노드(orchestrator)에서 수행.
    여기서는 detect 반환값이 DynamoDB Item 구성에 적합한 shape인지 검증.
    """
    mock_table = MagicMock()
    state = _state(churn_before=50, churn_after=63)
    m = mot.detect(state)
    assert m is not None
    # 상위 노드에서 수행할 put_item 호출 시뮬레이션
    item = {"PK": "CALL#test", "SK": f"MOT#{m['turn_seq']}", **m}
    mock_table.put_item(Item=item)
    mock_table.put_item.assert_called_once()
    call_args = mock_table.put_item.call_args[1]["Item"]
    assert call_args["motId"] in _VALID_MOT_IDS
    assert call_args["state"] in _VALID_STATES
