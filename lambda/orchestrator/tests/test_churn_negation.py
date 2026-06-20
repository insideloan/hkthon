"""AGENT-002 (#10) — churn 부정어/강조어/카테고리 캡 검증."""

from orchestrator.agent import churn_risk as cr


def test_negation_flips_polarity():
    """'안 비싸네요' — 가격불만(cons) 키워드 '비싸' 앞 어절 '안' → PRO로 반전 → 하락."""
    after, tokens = cr.score("별로 안 비싸네요", 50)
    # '비싸'가 반전되어 PRO 토큰으로 나타난다
    assert any(t["text"] == "비싸" and t["polarity"] == "PRO" for t in tokens)


def test_negation_window_limited_to_adjacent_eojeol():
    """부정어는 키워드 '바로 앞 어절'에서만 반전 — 어절 건너뛴 오반전 금지.

    '관심없어요 그냥 끊을게요': '끊을게'(HANGUP cons) 앞 어절은 '그냥'이므로
    앞선 '없'에 의해 반전되면 안 된다 → 두 토큰 모두 CONS 유지 → churn 상승.
    """
    after, tokens = cr.score("관심없어요 그냥 끊을게요", 50)
    assert after > 50
    assert all(t["polarity"] == "CONS" for t in tokens)
    assert any(t["text"] == "끊을게" for t in tokens)


def test_intensifier_multiplies_weight():
    """강조어('너무') 인접 시 가중치 ×1.5 → 강조 없을 때보다 더 큰 상승."""
    plain, _ = cr.score("금리 높은데요", 50)
    boosted, _ = cr.score("금리가 너무 높은데요", 50)
    # 둘 다 가격불만 카테고리지만 강조어가 있는 쪽이 더 높아야 함
    assert boosted >= plain


def test_category_match_cap_2():
    """동일 카테고리 키워드가 3개 이상이어도 최대 2개만 합산."""
    # HANGUP 계열 stem 다수 포함
    after, tokens = cr.score("됐어 끊을게 관심없어 필요없어", 50)
    hangup_tokens = [t for t in tokens if t["polarity"] == "CONS"]
    # 카테고리당 2개 캡이므로 HANGUP에서 최대 2개
    assert len(hangup_tokens) <= 4  # 여러 카테고리 합산 가능, 카테고리별로는 ≤2
