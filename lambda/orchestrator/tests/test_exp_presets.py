"""체험(exp-*) intent preset — 적용/격리 단위 검증.

핵심 계약:
- exp-* 콜만 preset을 탄다. 박서준(c-demo-*)은 절대 안 탄다(격리).
- compliance: 가안=preset(위반표현 포함), 최종=실 LLM draft. preset 수정후 텍스트는 버림.
- persist: preset으로 emotion/need/usability/strategy/tokens/db_* 채움.
LLM/langgraph 의존 없음 — nodes/compliance 헬퍼를 직접 호출.
"""

from __future__ import annotations

from orchestrator.agent import compliance, nodes
from orchestrator.agent.exp_presets import EXP_PRESETS, preset_for
from orchestrator.agent.state import Intent


def test_all_15_intents_have_presets():
    assert set(EXP_PRESETS) == set(Intent)
    assert len(EXP_PRESETS) == 15


def test_is_experience_guard():
    assert nodes.is_experience("exp-1782") is True
    assert nodes.is_experience("c-demo-01") is False
    assert nodes.is_experience(None) is False


def test_preset_injection_fills_signals_for_exp():
    state = {"call_id": "exp-9", "intent": Intent.INTEREST}
    nodes._apply_experience_preset("exp-9", state)
    assert state["emotion"] is not None          # 감정 채워짐
    assert state["strategy"]["headline"]          # 대표 전략 채워짐
    assert state["db_chips"]                       # DB 칩 채워짐
    assert state["db_nodes"]                       # DB 노드 채워짐
    assert state["churn_tokens"]                   # 발화분류 토큰 채워짐


def test_preset_injection_skips_cdemo():
    """박서준(c-demo-*)은 preset 분기를 타지 않는다 — state 무변경."""
    state = {"call_id": "c-demo-01", "intent": Intent.INTEREST}
    nodes._apply_experience_preset("c-demo-01", state)
    assert "emotion" not in state
    assert "strategy" not in state
    assert "db_chips" not in state


def test_compliance_exp_draft_is_preset_final_is_llm():
    """exp-*: 가안=preset(위반표현), 최종=실 LLM draft. preset 수정후 텍스트 미사용."""
    real_llm = "실제 LLM이 만든 안전한 최종 응답입니다."
    state = {"call_id": "exp-9", "intent": Intent.INTEREST}
    log, final = compliance.review_loop(real_llm, state)
    preset = preset_for(Intent.INTEREST)
    # 가안(drafting 단계)은 preset 텍스트
    assert log[0]["state"] == "drafting"
    assert log[0]["draft"] == preset.compliance_draft
    # 위반 표현이 reviewing 단계 violated_policies에 실린다
    reviewing = next(s for s in log if s["state"] == "reviewing")
    assert reviewing["violated_policies"] == preset.compliance_violations
    # 최종은 실 LLM draft (preset 수정후 텍스트 아님)
    assert final == real_llm
    assert log[-1]["final_text"] == real_llm


def test_compliance_cdemo_uses_normal_loop():
    """박서준(c-demo-*)은 preset 가안을 쓰지 않고 일반 review_loop를 탄다."""
    text = "안녕하세요 박서준님. 안전하게 안내드리겠습니다."
    state = {"call_id": "c-demo-01", "intent": Intent.INTEREST}
    log, final = compliance.review_loop(text, state)
    # 가안이 입력 텍스트 그대로(preset 아님)
    assert log[0]["draft"] == text
