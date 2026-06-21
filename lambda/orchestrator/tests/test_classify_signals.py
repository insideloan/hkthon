"""AGENT-005 — nodes.classify가 신호 4축을 엄격 파싱해 CallState에 채우는지 검증.

router.classify_turn을 가짜 결과로 대체(LLM 호출 없음).
"""

from orchestrator.agent import nodes, signals
from orchestrator.agent.signals import Emotion, Need, Tactic, Usability
from orchestrator.llm.router import ClassifyResult


def _patch(monkeypatch, **fields):
    """classify_turn이 주어진 필드의 ClassifyResult를 반환하도록 패치."""
    base = dict(intent="INTEREST", route="RESPOND")
    base.update(fields)
    monkeypatch.setattr(nodes.router, "classify_turn", lambda system, user: ClassifyResult(**base))


def test_classify_fills_signal_axes(monkeypatch):
    _patch(
        monkeypatch,
        emotion="부담",
        need="월납입 절감",
        usability="기존 대출 비교 후 판단",
        strategy_tactic="대환 제안 전략",
        strategy_headline="대환 절감 비교 유도",
    )
    out = nodes.classify({"customer_text": "지금 대출보다 월 납입이 줄어요?", "history": []})

    assert out["emotion"] == Emotion.BURDENED
    assert out["need"] == Need.LOWER_PAYMENT
    assert out["usability"] == Usability.AFTER_COMPARE
    assert out["strategy"]["tactic"] == Tactic.PROPOSE_REFINANCE.value
    assert out["classified_by"] == "llm"


def test_classify_out_of_catalog_signal_falls_back_to_none(monkeypatch):
    """카탈로그 밖 신호 라벨 → None (엄격 Enum)."""
    _patch(monkeypatch, emotion="행복함", need="우주여행", usability="순간이동")
    out = nodes.classify({"customer_text": "음 글쎄요", "history": []})

    assert out["emotion"] is None
    assert out["need"] is None
    assert out["usability"] is None


def test_classify_out_of_catalog_tactic_preserves_raw(monkeypatch):
    """전략은 카탈로그 밖이어도 화면 표시를 위해 원문 보존."""
    _patch(monkeypatch, strategy_tactic="신박한전략", strategy_headline="h")
    out = nodes.classify({"customer_text": "x", "history": []})
    assert out["strategy"]["tactic"] == "신박한전략"


def test_classify_llm_failure_falls_back(monkeypatch):
    """classify_turn None → 보수적 기본값(통화 흐름 유지). 신호축 키 없음."""
    monkeypatch.setattr(nodes.router, "classify_turn", lambda system, user: None)
    out = nodes.classify({"customer_text": "x", "history": []})
    assert out["intent"].value == "UNCLEAR"
    assert out["route"].value == "RESPOND"
    assert "emotion" not in out


def test_classify_system_prompt_embeds_catalog():
    """classify 시스템 프롬프트에 신호 카탈로그 라벨이 주입된다."""
    from orchestrator.agent import prompts
    from orchestrator.agent.state import Stage

    sys = prompts.classify_system(Stage.PROPOSE)
    # 4축 대표 라벨이 프롬프트에 포함되어야 LLM이 그 안에서 고른다
    assert "부담" in sys                      # Emotion
    assert "월납입 절감" in sys                # Need
    assert "기존 대출 비교 후 판단" in sys      # Usability
    assert "대환 제안 전략" in sys             # Tactic
