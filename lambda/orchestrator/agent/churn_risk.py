"""이탈위험도 점수 계산 / Churn-risk scoring.

AGENT 모듈. SSOT: hk-skills/reference/CHURN-RISK-LEXICON.md.
사전(data/lexicon/churn_risk_lexicon.json) 로드 → 결정적 키워드 점수 + EMA 평활.
LLM 단독 판단이 아니라 사전 점수가 1차 진실(데모 안정성).
"""

from __future__ import annotations

from .state import Token

# 모델 파라미터 (CHURN-RISK-LEXICON §1) — 실제 값은 JSON model 블록에서 로드
_BASELINE = 50
_EMA_ALPHA = 0.6
_TURN_CLAMP = (-40, 40)
_SCORE_CLAMP = (0, 100)
_MAX_MATCHES_PER_CAT = 2
_SILENCE_PENALTY = 6
_NEGATION_WINDOW = 7
_INTENSIFIER_MULT = 1.5


def score(
    customer_text: str,
    churn_before: int,
    *,
    adjust: int = 0,
    silence_streak: int = 0,
) -> tuple[int, list[Token]]:
    """이번 턴 churn_risk 갱신값과 매칭 토큰을 반환.

    Args:
        customer_text: STT 고객 발화 (ko-KR).
        churn_before: 직전 턴 churn_risk (EMA용).
        adjust: classify LLM 보정 제안 (±10 한도, 사전 점수 우선).
        silence_streak: 연속 무발화/최소응답 횟수 (2턴↑ → +6).

    Returns:
        (churn_after, tokens)
    """
    # TODO: _lexicon() 로드 후 카테고리별 키워드 매칭
    #   1. 정규화 → 부정어(negation_window) 반전 → 강조어 ×1.5
    #   2. 카테고리당 최대 2개 합산 → turn_raw
    #   3. turn_score = clamp(baseline + turn_raw, 0, 100)
    #   4. silence_streak>=2 → turn_raw += 6
    #   5. churn_after = round(α*turn_score + (1-α)*churn_before)
    #   6. adjust는 ±10 clamp 후 가산, 최종 clamp(0,100)
    tokens: list[Token] = []
    turn_raw = 0  # TODO 매칭 합산

    if silence_streak >= 2:
        turn_raw += _SILENCE_PENALTY

    turn_raw = _clamp(turn_raw, *_TURN_CLAMP)
    turn_score = _clamp(_BASELINE + turn_raw, *_SCORE_CLAMP)
    churn_after = round(_EMA_ALPHA * turn_score + (1 - _EMA_ALPHA) * churn_before)
    churn_after += _clamp(adjust, -10, 10)
    return _clamp(churn_after, *_SCORE_CLAMP), tokens


def band(churn: int) -> str:
    """게이지 밴드 (CHURN-RISK-LEXICON §0)."""
    if churn <= 33:
        return "low"
    if churn <= 66:
        return "medium"
    return "high"


def _clamp(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, v))


def _lexicon() -> dict:
    """data/lexicon/churn_risk_lexicon.json 로드 (S3 또는 번들). 1회 캐시."""
    # TODO: S3/로컬에서 로드 후 모듈 캐시. DATA 모듈이 S3 배포본 소유.
    raise NotImplementedError
