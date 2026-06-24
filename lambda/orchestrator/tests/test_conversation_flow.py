"""conversation_flow — 대출 상담 6단계 State 재구성 + fast_route 종료/방어 규칙."""

from __future__ import annotations

from orchestrator.agent import conversation_flow as cf
from orchestrator.agent import nodes
from orchestrator.agent.state import Route


def _h(*turns):
    """(speaker, text) 튜플들을 history(list[TurnMsg-like])로."""
    return [{"seq": i, "speaker": s, "text": t} for i, (s, t) in enumerate(turns)]


# ── 단계 순차 진행 ────────────────────────────────────────────────────────────


def test_identity_confirmed_on_affirmative():
    flow = cf.reconstruct({"history": _h(("bot", "박서준 고객님 맞으세요?")), "customer_text": "네 맞아요"})
    assert flow["identity_confirmed"] is True
    assert flow["availability_confirmed"] is False


def test_availability_after_identity():
    hist = _h(
        ("bot", "박서준 고객님 맞으세요?"),
        ("customer", "네 맞아요"),
        ("bot", "지금 통화 잠깐 괜찮으실까요?"),
    )
    flow = cf.reconstruct({"history": hist, "customer_text": "네 괜찮아요"})
    assert flow["identity_confirmed"] and flow["availability_confirmed"]
    assert flow["offer_made"] is False


def test_offer_made_then_interest_proceed():
    hist = _h(
        ("bot", "박서준 고객님 맞으세요?"),
        ("customer", "네 맞아요"),
        ("bot", "지금 통화 괜찮으세요?"),
        ("customer", "네 괜찮아요"),
        ("bot", "기존 대출보다 금리를 비교해 안내드릴 수 있어요."),  # 오퍼
    )
    flow = cf.reconstruct({"history": hist, "customer_text": "네 진행할게요"})
    assert flow["offer_made"] is True
    assert flow["loan_interest_answered"] is True
    assert flow["loan_decision"] == "proceed"
    assert cf.all_steps_done(flow) is True


def test_interest_decline():
    hist = _h(
        ("bot", "박서준 고객님 맞으세요?"),
        ("customer", "네 맞아요"),
        ("bot", "지금 통화 괜찮으세요?"),
        ("customer", "네"),
        ("bot", "기존 대출 대비 대환 금리를 비교해 드릴게요."),
    )
    flow = cf.reconstruct({"history": hist, "customer_text": "아니요 안 할래요"})
    assert flow["loan_interest_answered"] is True
    assert flow["loan_decision"] == "decline"
    assert cf.all_steps_done(flow) is True


# ── 거절 횟수 / 방어·종료 ─────────────────────────────────────────────────────


def test_rejection_count_first_then_defense():
    flow = cf.reconstruct({"history": _h(("bot", "박서준 고객님 맞으세요?")), "customer_text": "대출 전화면 안 받아요"})
    assert flow["rejection_count"] == 1
    assert cf.is_first_rejection_defense(flow) is True
    assert cf.should_close(flow) is False


def test_rejection_count_two_closes():
    hist = _h(
        ("bot", "안녕하세요 현대캐피탈입니다."),
        ("customer", "대출 전화면 안 받아요"),  # 거절 1
        ("bot", "잠깐만 들어주세요, 부담 없는 비교만 도와드릴게요."),
    )
    flow = cf.reconstruct({"history": hist, "customer_text": "관심없어요 끊을게요"})  # 거절 2
    assert flow["rejection_count"] == 2
    assert cf.should_close(flow) is True
    assert cf.is_first_rejection_defense(flow) is False


# ── fast_route 통합 ──────────────────────────────────────────────────────────


def test_fast_route_first_rejection_defends_respond():
    state = {"customer_text": "대출 전화면 안 받아요", "history": _h(("bot", "박서준 고객님 맞으세요?"))}
    state["flow"] = cf.reconstruct(state)
    out = nodes.fast_route(state)
    assert out["route"] == Route.RESPOND  # 첫 거절은 방어(종료 아님)


def test_fast_route_second_rejection_closes():
    hist = _h(
        ("bot", "안녕하세요"),
        ("customer", "안 받아요"),
        ("bot", "잠깐만요"),
    )
    state = {"customer_text": "관심없어요 끊어요", "history": hist}
    state["flow"] = cf.reconstruct(state)
    out = nodes.fast_route(state)
    assert out["route"] == Route.CLOSE


def test_fast_route_all_steps_done_closes():
    hist = _h(
        ("bot", "박서준 고객님 맞으세요?"),
        ("customer", "네 맞아요"),
        ("bot", "지금 통화 괜찮으세요?"),
        ("customer", "네"),
        ("bot", "기존 대출 대비 금리를 비교해 드릴게요."),
    )
    state = {"customer_text": "네 진행할게요", "history": hist}
    state["flow"] = cf.reconstruct(state)
    out = nodes.fast_route(state)
    assert out["route"] == Route.CLOSE


def test_close_node_proceed_offers_intake():
    hist = _h(
        ("bot", "박서준 고객님 맞으세요?"),
        ("customer", "네"),
        ("bot", "통화 괜찮으세요?"),
        ("customer", "네"),
        ("bot", "대출 금리 비교 안내드릴게요."),
    )
    state = {"customer_text": "네 진행할게요", "history": hist}
    state["flow"] = cf.reconstruct(state)
    out = nodes.close_node(state)
    assert out["call_status"].value == "ENDED"
    assert "AI 본심사" in out["bot_text"]
    assert out.get("result_type") == "AI_본심사"


def test_close_node_decline_polite():
    hist = _h(
        ("bot", "박서준 고객님 맞으세요?"),
        ("customer", "네"),
        ("bot", "통화 괜찮으세요?"),
        ("customer", "네"),
        ("bot", "대출 금리 비교 안내드릴게요."),
    )
    state = {"customer_text": "아니요 안 할래요", "history": hist}
    state["flow"] = cf.reconstruct(state)
    out = nodes.close_node(state)
    assert out["call_status"].value == "ENDED"
    assert "AI 본심사" not in out["bot_text"]
    assert out.get("result_type") is None
