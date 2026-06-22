"""AGENT-011 (#19) — 발화 분석(analysis.py) 검증.

SSOT-3 재정렬 기준:
  - 토큰 shape {text, polarity, reason} 유지.
  - polarity: "PRO"|"CONS"|null 집합 유지 (소비 목적: flag 배지 분기용).
  - 비키워드 어절도 polarity=None으로 반환 (발화 시각화, dev 발화분석 기반로직).
  - 턴 레벨 flag: "risk"|"def"|null.
  - 키워드 색상 클래스(k-go/k-risk) 드라이빙 없음 (SSOT-3 정합).
  - churn_risk 렉시콘/매칭 규칙 재사용(부정 반전 포함).
"""

from orchestrator.agent import analysis as an
from orchestrator.agent.analysis import derive_turn_flag
from orchestrator.agent.state import Token


def _by_text(tokens):
    """text → token 매핑(첫 등장)."""
    out = {}
    for t in tokens:
        out.setdefault(t["text"], t)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# 토큰 shape 유지 검증
# ─────────────────────────────────────────────────────────────────────────────


def test_token_shape_has_required_fields():
    """토큰이 {text, polarity, reason} 세 필드를 모두 포함한다."""
    _, tokens, _ = an.analyze("그냥 끊을게요", 50)
    assert len(tokens) > 0
    for tok in tokens:
        assert "text" in tok
        assert "polarity" in tok
        assert "reason" in tok


def test_polarity_values_are_valid_set():
    """polarity 값은 "PRO"·"CONS"·None 집합에 속한다 (SSOT-3 유지)."""
    _, tokens, _ = an.analyze("갈아타고 싶어요 근데 끊을게요", 50)
    valid = {"PRO", "CONS", None}
    for tok in tokens:
        assert tok["polarity"] in valid


# ─────────────────────────────────────────────────────────────────────────────
# Acceptance #1 — PRO/CONS 분류 (어절 단위)
# ─────────────────────────────────────────────────────────────────────────────


def test_cons_keyword_classified():
    """이탈 신호(거절) → CONS."""
    _, tokens, _ = an.analyze("그냥 끊을게요", 50)
    toks = _by_text(tokens)
    assert toks["끊을게요"]["polarity"] == "CONS"


def test_pro_keyword_classified():
    """성공경로 신호(상담원 연결) → PRO."""
    _, tokens, _ = an.analyze("상담원 연결해주세요", 70)
    assert any(t["polarity"] == "PRO" for t in tokens)


# ─────────────────────────────────────────────────────────────────────────────
# Acceptance #2 — reason이 매칭 카테고리 반영
# ─────────────────────────────────────────────────────────────────────────────


def test_reason_reflects_lexicon_category():
    """reason 필드가 매칭 렉시콘 카테고리 설명을 반영한다 (비어있지 않음)."""
    _, tokens, _ = an.analyze("끊을게요", 50)
    toks = _by_text(tokens)
    reason = toks["끊을게요"]["reason"]
    assert reason and isinstance(reason, str) and len(reason) > 0


# ─────────────────────────────────────────────────────────────────────────────
# Acceptance #3 — 비키워드 토큰 polarity=None (발화 시각화 기반로직)
# ─────────────────────────────────────────────────────────────────────────────


def test_non_keyword_polarity_is_none():
    """비키워드 어절은 polarity=None + reason="" (발화 순서 보존)."""
    _, tokens, _ = an.analyze("그냥 끊을게요", 50)
    toks = _by_text(tokens)
    assert toks["그냥"]["polarity"] is None
    assert toks["그냥"]["reason"] == ""


def test_all_non_keyword_sentence():
    """키워드 전무(중립 발화) → 모든 토큰 polarity=None."""
    _, tokens, _ = an.analyze("어제 비가 왔어요", 50)
    assert all(t["polarity"] is None for t in tokens)
    assert len(tokens) == 3


# ─────────────────────────────────────────────────────────────────────────────
# churn_risk 규칙 재사용 — 부정 반전 / 다중 어절 stem / 순서·빈입력
# ─────────────────────────────────────────────────────────────────────────────


def test_negation_flips_polarity():
    """바로 앞 어절 부정어 → 부호 반전 (churn_risk 규칙)."""
    _, plain_tokens, _ = an.analyze("끊을게요", 50)
    _, neg_tokens, _ = an.analyze("안 끊을게요", 50)
    plain_polarity = _by_text(plain_tokens)["끊을게요"]["polarity"]
    neg_polarity = _by_text(neg_tokens)["끊을게요"]["polarity"]
    assert plain_polarity == "CONS"
    assert neg_polarity == "PRO"  # 반전


def test_multi_eojeol_stem_matched():
    """공백 포함 stem('금리 높')도 해당 구절 어절에 polarity 부여."""
    _, tokens, _ = an.analyze("금리가 너무 높아요", 50)
    # 매칭 구간에 걸친 어절 중 적어도 하나는 CONS로 분류돼야 함
    assert any(t["polarity"] == "CONS" for t in tokens)


def test_preserves_order_and_text():
    """어절 순서와 text 값이 발화 원문을 보존한다."""
    _, tokens, _ = an.analyze("그냥 끊을게요", 50)
    assert [t["text"] for t in tokens] == ["그냥", "끊을게요"]


def test_empty_input_returns_empty():
    """빈 입력은 토큰이 없고 flag=None."""
    _, tokens, flag = an.analyze("", 50)
    assert tokens == []
    assert flag is None
    _, tokens2, flag2 = an.analyze("   ", 50)
    assert tokens2 == []
    assert flag2 is None


# ─────────────────────────────────────────────────────────────────────────────
# 턴 레벨 flag 산출 검증 (derive_turn_flag 직접)
# ─────────────────────────────────────────────────────────────────────────────


def test_flag_risk_when_cons_dominates():
    """CONS 토큰이 PRO보다 많으면 flag="risk" (위험 턴)."""
    tokens: list[Token] = [
        {"text": "끊을게요", "polarity": "CONS", "reason": "통화 종료 의사"},
        {"text": "관심없어요", "polarity": "CONS", "reason": "명시적 무관심"},
    ]
    assert derive_turn_flag(tokens) == "risk"


def test_flag_def_when_pro_dominates():
    """PRO 토큰이 CONS 이상이면 flag="def" (방어 턴)."""
    tokens: list[Token] = [
        {"text": "상담원 연결", "polarity": "PRO", "reason": "한도조회·상담원 연결 요청"},
        {"text": "신청할게요", "polarity": "PRO", "reason": "구매·진척 의사"},
    ]
    assert derive_turn_flag(tokens) == "def"


def test_flag_null_when_no_tokens():
    """토큰이 없으면 flag=None (중립 턴)."""
    assert derive_turn_flag([]) is None


def test_flag_null_when_no_polarity_tokens():
    """polarity가 모두 None인 토큰만 있으면 flag=None."""
    tokens: list[Token] = [
        {"text": "그냥요", "polarity": None, "reason": ""},
    ]
    assert derive_turn_flag(tokens) is None


def test_flag_risk_when_cons_exceeds_pro():
    """CONS 2개 PRO 1개 → flag="risk"."""
    tokens: list[Token] = [
        {"text": "끊을게요", "polarity": "CONS", "reason": "통화 종료 의사"},
        {"text": "바빠요", "polarity": "CONS", "reason": "시간 압박"},
        {"text": "잠깐만요", "polarity": "PRO", "reason": "경청·긍정"},
    ]
    assert derive_turn_flag(tokens) == "risk"


def test_flag_def_when_pro_equals_cons():
    """PRO == CONS일 때 flag="def" (방어 우세 판정, SSOT-3 §flag 배지 분기)."""
    tokens: list[Token] = [
        {"text": "끊을게요", "polarity": "CONS", "reason": "통화 종료 의사"},
        {"text": "상담원 연결", "polarity": "PRO", "reason": "성공경로"},
    ]
    assert derive_turn_flag(tokens) == "def"


# ─────────────────────────────────────────────────────────────────────────────
# analyze() 통합 검증
# ─────────────────────────────────────────────────────────────────────────────


def test_analyze_returns_three_tuple():
    """analyze()는 (churn_after, tokens, turn_flag) 3-tuple을 반환한다."""
    result = an.analyze("끊을게요", 50)
    assert len(result) == 3
    churn_after, tokens, flag = result
    assert isinstance(churn_after, int)
    assert isinstance(tokens, list)
    assert flag in ("risk", "def", None)


def test_analyze_risk_turn():
    """이탈 발화 분석 시 churn 상승 + flag="risk" (키워드 색상 드라이빙 없음)."""
    churn_after, tokens, flag = an.analyze("끊을게요 관심없어요", 50)
    assert churn_after > 50
    assert flag == "risk"
    # SSOT-3 정합: polarity는 flag 배지 분기 전용, k-go/k-risk 색상 클래스와 무관
    assert all(t["polarity"] in ("PRO", "CONS", None) for t in tokens)


def test_analyze_success_path_turn():
    """성공경로 발화 분석 시 churn 하락 + flag="def"."""
    churn_after, tokens, flag = an.analyze("상담원 연결해주세요", 70)
    assert churn_after < 70
    assert flag == "def"


def test_analyze_neutral_turn():
    """중립 발화 분석 시 토큰에 키워드 없음 + flag=None."""
    _, tokens, flag = an.analyze("음 그냥요", 50)
    # 비키워드 어절은 polarity=None으로 반환 (발화 시각화)
    assert all(t["polarity"] is None for t in tokens)
    assert flag is None
