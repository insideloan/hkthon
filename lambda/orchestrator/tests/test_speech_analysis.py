"""AGENT-011 (#19) — 발화 분석 토큰 shape + 턴 레벨 flag 산출 검증.

SSOT-3 재정렬 기준:
  - 토큰 shape {text, polarity, reason} 유지.
  - polarity: "PRO"|"CONS"|null 집합 유지 (소비 목적: flag 배지 분기용).
  - 턴 레벨 flag: "risk"|"def"|null.
  - 키워드 색상 클래스(k-go/k-risk) 드라이빙 없음 (SSOT-3 정합).
"""

from orchestrator.agent import analysis as an
from orchestrator.agent.analysis import derive_turn_flag
from orchestrator.agent.state import Token


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


def test_cons_polarity_for_risk_keyword():
    """이탈 신호 키워드는 polarity="CONS" 토큰을 생성한다."""
    _, tokens, _ = an.analyze("그냥 끊을게요", 50)
    assert any(t["polarity"] == "CONS" for t in tokens)


def test_pro_polarity_for_success_path_keyword():
    """성공경로 신호(상담원 연결)는 polarity="PRO" 토큰을 생성한다."""
    _, tokens, _ = an.analyze("상담원 연결해주세요", 70)
    assert any(t["polarity"] == "PRO" for t in tokens)


def test_no_keyword_yields_empty_tokens():
    """비키워드 발화는 토큰이 없고 polarity=null (빈 목록)."""
    _, tokens, _ = an.analyze("음 그냥요", 50)
    assert tokens == []


def test_reason_reflects_lexicon_category():
    """reason 필드가 매칭 렉시콘 카테고리 설명을 반영한다 (비어있지 않음)."""
    _, tokens, _ = an.analyze("끊을게요", 50)
    assert len(tokens) > 0
    for tok in tokens:
        assert isinstance(tok["reason"], str)
        assert len(tok["reason"]) > 0


def test_polarity_values_are_valid_set():
    """polarity 값은 "PRO"·"CONS"·None 집합에 속한다 (SSOT-3 유지)."""
    _, tokens, _ = an.analyze("갈아타고 싶어요 근데 끊을게요", 50)
    valid = {"PRO", "CONS", None}
    for tok in tokens:
        assert tok["polarity"] in valid


# ─────────────────────────────────────────────────────────────────────────────
# 턴 레벨 flag 산출 검증
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
    """중립 발화 분석 시 토큰 없음 + flag=None."""
    _, tokens, flag = an.analyze("음 그냥요", 50)
    assert tokens == []
    assert flag is None
