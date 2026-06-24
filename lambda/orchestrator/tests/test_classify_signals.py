"""AGENT-005 — nodes.classify가 신호 4축을 엄격 파싱해 CallState에 채우는지 검증.

router.classify_turn을 가짜 결과로 대체(LLM 호출 없음).
"""

from orchestrator.agent import nodes
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
    # 카드 부연 lead(.slead)는 tactic으로부터 SSOT-3 정본 매핑 (Drift 3)
    assert out["strategy"]["lead"] == "갈아타기 가능성과 절감 효과를 확인시킨다"
    assert out["classified_by"] == "llm"


def test_classify_out_of_catalog_signal_falls_back_to_none(monkeypatch):
    """카탈로그 밖 신호 라벨 → None (엄격 Enum)."""
    _patch(monkeypatch, emotion="행복함", need="우주여행", usability="순간이동")
    out = nodes.classify({"customer_text": "음 글쎄요", "history": []})

    assert out["emotion"] is None
    assert out["need"] is None
    assert out["usability"] is None


def test_classify_out_of_catalog_tactic_preserves_raw(monkeypatch):
    """전략은 카탈로그 밖이어도 화면 표시를 위해 원문 보존. lead는 매핑 불가→키 없음(하위호환)."""
    _patch(monkeypatch, strategy_tactic="신박한전략", strategy_headline="h")
    out = nodes.classify({"customer_text": "x", "history": []})
    assert out["strategy"]["tactic"] == "신박한전략"
    assert "lead" not in out["strategy"]


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


# ─────────────────────────────────────────────────────────────────────────────
# respond 신호 주입 — classify가 고른 전략·감정이 응답 프롬프트에 반영
# ─────────────────────────────────────────────────────────────────────────────


def test_respond_system_embeds_tactic_and_emotion():
    from orchestrator.agent import prompts
    from orchestrator.agent.state import Stage

    sys = prompts.respond_system(
        Stage.PROPOSE, tactic=Tactic.PROPOSE_REFINANCE, emotion=Emotion.BURDENED
    )
    assert "대환 제안 전략" in sys
    assert "부담" in sys
    assert "신호 기반 응대 지침" in sys


def test_respond_system_without_signals_omits_block():
    """신호가 없으면 전략 블록을 넣지 않는다(stage 지침만으로 응대)."""
    from orchestrator.agent import prompts
    from orchestrator.agent.state import Stage

    sys = prompts.respond_system(Stage.IDENTIFY)
    assert "신호 기반 응대 지침" not in sys


def test_respond_node_passes_signals_to_prompt(monkeypatch):
    """nodes.respond가 state의 strategy.tactic/emotion을 respond_system에 전달."""
    captured = {}

    def fake_respond_system(stage, customer=None, *, tactic=None, emotion=None):
        captured["tactic"] = tactic
        captured["emotion"] = emotion
        return "SYS"

    monkeypatch.setattr(nodes.prompts, "respond_system", fake_respond_system)
    monkeypatch.setattr(nodes.router, "converse", lambda system, user, stream=True: "응답")

    out = nodes.respond({
        "customer_text": "월 납입 줄어요?",
        "history": [],
        "strategy": {"tactic": Tactic.PROPOSE_REFINANCE.value},
        "emotion": Emotion.BURDENED,
    })
    assert out["bot_draft"] == "응답"
    assert captured["tactic"] == Tactic.PROPOSE_REFINANCE
    assert captured["emotion"] == Emotion.BURDENED


# ─────────────────────────────────────────────────────────────────────────────
# FUSED_TURN — 분류+응답+신뢰도 단일 호출 (classify 노드 게이트)
# ─────────────────────────────────────────────────────────────────────────────


def test_classify_fused_mode_maps_result_and_stashes_draft(monkeypatch):
    """FUSED_TURN=1: classify_respond_fused 결과를 state로 매핑하고 응답을 _blind_draft에,
    신뢰도를 _compliance_confidence에 싣는다."""
    result = ClassifyResult(
        intent="INTEREST", route="RESPOND", emotion="부담",
        strategy_tactic="대환 제안 전략", strategy_headline="h",
    )
    monkeypatch.setattr(nodes, "_FUSED_TURN", True)
    monkeypatch.setattr(
        nodes.router, "classify_respond_fused",
        lambda fused_system, history: (result, "안내 응답입니다.", 0.92),
    )
    out = nodes.classify({"customer_text": "월 납입 줄어요?", "history": []})

    assert out["emotion"] == Emotion.BURDENED
    assert out["strategy"]["tactic"] == Tactic.PROPOSE_REFINANCE.value
    assert out["_blind_draft"] == "안내 응답입니다."        # respond 노드가 재사용
    assert out["_compliance_confidence"] == 0.92            # compliance 게이트가 사용
    assert out["classified_by"] == "llm"


def test_classify_fused_empty_response_leaves_draft_none(monkeypatch):
    """fused 응답 텍스트가 비면(SILENCE 등) _blind_draft=None → respond 노드가 정식 생성."""
    result = ClassifyResult(intent="SILENCE", route="SILENCE")
    monkeypatch.setattr(nodes, "_FUSED_TURN", True)
    monkeypatch.setattr(
        nodes.router, "classify_respond_fused",
        lambda fused_system, history: (result, "", 1.0),
    )
    out = nodes.classify({"customer_text": "...", "history": []})
    assert out["_blind_draft"] is None


def test_classify_fused_parse_failure_falls_back_to_serial(monkeypatch):
    """fused가 None(파싱 실패)이면 직렬 classify_turn 경로로 폴백한다."""
    monkeypatch.setattr(nodes, "_FUSED_TURN", True)
    monkeypatch.setattr(nodes.router, "classify_respond_fused", lambda fused_system, history: None)
    called = {}

    def fake_classify_turn(system, user):
        called["serial"] = True
        return ClassifyResult(intent="INTEREST", route="RESPOND")

    monkeypatch.setattr(nodes.router, "classify_turn", fake_classify_turn)
    out = nodes.classify({"customer_text": "x", "history": []})
    assert called.get("serial") is True
    assert out["route"].value == "RESPOND"
    assert "_compliance_confidence" not in out   # 직렬 경로는 신뢰도 미설정


def test_classify_fused_system_prompt_has_all_three_sections():
    """fused_system 프롬프트가 분류/응답/신뢰도 세 작업과 JSON 형태를 담는다."""
    from orchestrator.agent import prompts
    from orchestrator.agent.state import Stage

    sys = prompts.fused_system(Stage.PROPOSE)
    assert "classify" in sys and "response" in sys and "compliance_confidence" in sys
    assert "대환 제안 전략" in sys      # 신호 카탈로그 주입
    assert "금지 표현" in sys           # 금지표현 사전주입


# ─────────────────────────────────────────────────────────────────────────────
# history 윈도잉 — 최근 N개만 렌더
# ─────────────────────────────────────────────────────────────────────────────


def test_render_history_windows_to_recent(monkeypatch):
    """_HISTORY_WINDOW개를 초과하면 최근 N개만 렌더(직전 맥락 유지)."""
    monkeypatch.setattr(nodes, "_HISTORY_WINDOW", 3)
    history = [{"speaker": "customer", "text": f"메시지{i}"} for i in range(10)]
    rendered = nodes._render_history({"history": history, "customer_text": "지금발화"})
    # 최근 3개 history + 현재 발화만
    assert "메시지9" in rendered and "메시지8" in rendered and "메시지7" in rendered
    assert "메시지6" not in rendered and "메시지0" not in rendered
    assert "지금발화" in rendered


def test_render_history_no_window_when_zero(monkeypatch):
    """_HISTORY_WINDOW<=0이면 전체 history를 렌더(무제한)."""
    monkeypatch.setattr(nodes, "_HISTORY_WINDOW", 0)
    history = [{"speaker": "customer", "text": f"메시지{i}"} for i in range(10)]
    rendered = nodes._render_history({"history": history, "customer_text": "x"})
    assert "메시지0" in rendered and "메시지9" in rendered


# ─────────────────────────────────────────────────────────────────────────────
# 멀티턴 history 메시지 — 마지막 user = 현재 발화, 앞선 turn = role별 분리
# ─────────────────────────────────────────────────────────────────────────────


def test_render_history_messages_splits_roles_last_is_current():
    """고객→user, 상담봇/상담원→assistant로 분리하고 현재 발화를 마지막 user로 덧붙인다."""
    history = [
        {"speaker": "customer", "text": "여보세요?"},
        {"speaker": "bot", "text": "안녕하세요"},
        {"speaker": "customer", "text": "금리 궁금해요"},
        {"speaker": "agent", "text": "확인해드릴게요"},
    ]
    msgs = nodes._render_history_messages(
        {"history": history, "customer_text": "지금 발화"}
    )
    assert [m["role"] for m in msgs] == ["user", "assistant", "user", "assistant", "user"]
    # 마지막은 현재 답해야 할 고객 발화.
    assert msgs[-1]["role"] == "user" and "지금 발화" in msgs[-1]["content"]
    # 화자 라벨 보존.
    assert msgs[0]["content"].startswith("고객:")
    assert msgs[1]["content"].startswith("상담봇:")


def test_render_history_messages_windows_to_recent(monkeypatch):
    """_HISTORY_WINDOW 초과 시 최근 N개 turn만(+현재 발화) 메시지로 렌더."""
    monkeypatch.setattr(nodes, "_HISTORY_WINDOW", 3)
    history = [{"speaker": "customer", "text": f"메시지{i}"} for i in range(10)]
    msgs = nodes._render_history_messages(
        {"history": history, "customer_text": "지금발화"}
    )
    joined = " ".join(m["content"] for m in msgs)
    assert "메시지9" in joined and "메시지7" in joined
    assert "메시지6" not in joined and "메시지0" not in joined
    assert msgs[-1]["content"].endswith("지금발화")
