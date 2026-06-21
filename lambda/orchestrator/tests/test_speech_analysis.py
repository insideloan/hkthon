"""AGENT-011 (#19) — 발화 분석(analysis.py) 검증.

발화 → tokens[{text, polarity, reason}]. 키워드는 PRO/CONS+reason, 비키워드는 polarity=None.
churn_risk 렉시콘/매칭 규칙 재사용(부정 반전 포함).
"""

from orchestrator.agent import analysis


def _by_text(tokens):
    """text → token 매핑(첫 등장)."""
    out = {}
    for t in tokens:
        out.setdefault(t["text"], t)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Acceptance #1 — PRO/CONS 분류
# ─────────────────────────────────────────────────────────────────────────────


def test_cons_keyword_classified():
    """이탈 신호(거절) → CONS."""
    toks = _by_text(analysis.analyze("그냥 끊을게요"))
    assert toks["끊을게요"]["polarity"] == "CONS"


def test_pro_keyword_classified():
    """성공경로 신호(한도조회) → PRO."""
    toks = _by_text(analysis.analyze("한도 조회 해주세요"))
    assert toks["한도"]["polarity"] == "PRO"
    assert toks["조회"]["polarity"] == "PRO"


# ─────────────────────────────────────────────────────────────────────────────
# Acceptance #2 — reason이 매칭 카테고리 반영
# ─────────────────────────────────────────────────────────────────────────────


def test_reason_reflects_category():
    """reason은 매칭 카테고리 desc를 담는다(빈 문자열 아님)."""
    toks = _by_text(analysis.analyze("끊을게요"))
    reason = toks["끊을게요"]["reason"]
    assert reason and "거절" in reason


def test_pro_and_cons_have_distinct_reasons():
    """서로 다른 카테고리는 서로 다른 reason."""
    cons = _by_text(analysis.analyze("끊을게요"))["끊을게요"]["reason"]
    pro = _by_text(analysis.analyze("한도조회"))["한도조회"]["reason"]
    assert cons != pro


# ─────────────────────────────────────────────────────────────────────────────
# Acceptance #3 — 비키워드 토큰 polarity=None
# ─────────────────────────────────────────────────────────────────────────────


def test_non_keyword_polarity_is_none():
    toks = _by_text(analysis.analyze("그냥 끊을게요"))
    assert toks["그냥"]["polarity"] is None
    assert toks["그냥"]["reason"] == ""


def test_all_non_keyword_sentence():
    """키워드 전무(중립 발화) → 모든 토큰 polarity=None."""
    toks = analysis.analyze("어제 비가 왔어요")
    assert all(t["polarity"] is None for t in toks)
    assert len(toks) == 3


# ─────────────────────────────────────────────────────────────────────────────
# churn_risk 규칙 재사용 — 부정 반전 / 다중 어절 stem / 순서·빈입력
# ─────────────────────────────────────────────────────────────────────────────


def test_negation_flips_polarity():
    """바로 앞 어절 부정어 → 부호 반전 (churn_risk 규칙)."""
    plain = _by_text(analysis.analyze("끊을게요"))["끊을게요"]["polarity"]
    negated = _by_text(analysis.analyze("안 끊을게요"))["끊을게요"]["polarity"]
    assert plain == "CONS"
    assert negated == "PRO"  # 반전


def test_multi_eojeol_stem_matched():
    """공백 포함 stem('금리 높')도 해당 구절 어절에 polarity 부여."""
    toks = analysis.analyze("금리가 너무 높아요")
    # 매칭 구간에 걸친 어절 중 적어도 하나는 CONS로 분류돼야 함
    assert any(t["polarity"] == "CONS" for t in toks)


def test_preserves_order_and_text():
    toks = analysis.analyze("그냥 끊을게요")
    assert [t["text"] for t in toks] == ["그냥", "끊을게요"]


def test_empty_input_returns_empty():
    assert analysis.analyze("") == []
    assert analysis.analyze("   ") == []
