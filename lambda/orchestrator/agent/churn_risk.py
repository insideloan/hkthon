"""이탈위험도 점수 계산 / Churn-risk scoring.

AGENT 모듈. SSOT: hk-skills/reference/CHURN-RISK-LEXICON.md.
사전(data/lexicon/churn_risk_lexicon.json) 로드 → 결정적 키워드 점수 + EMA 평활.
LLM 단독 판단이 아니라 사전 점수가 1차 진실(데모 안정성).

매칭 규칙 (CHURN-RISK-LEXICON §1):
  - stem 부분일치(정규화된 ko-KR STT 텍스트, 고객 발화만).
  - 부정어(negation_window_chars 이내) → 부호 반전.
  - 강조어 인접 → 가중치 ×intensifier_multiplier.
  - 카테고리당 최대 max_matches_per_category개만 합산.
  - turn_raw clamp → turn_score = baseline+turn_raw → EMA(α).
"""

from __future__ import annotations

import json
import logging
import os
import re
from functools import lru_cache
from pathlib import Path

from .state import Token

logger = logging.getLogger(__name__)

# 런타임 렉시콘 위치 (S3 동기화본). 없으면 reference 번들로 폴백.
_LEXICON_PATH = os.environ.get(
    "LEXICON_LOCAL_PATH",
    str(Path(__file__).resolve().parents[3] / "hk-skills" / "reference" / "churn_risk_lexicon.json"),
)

# model 블록 기본값 (JSON에서 로드되며, 로드 실패 시 폴백)
_DEFAULT_MODEL = {
    "baseline": 50,
    "ema_alpha": 0.6,
    "turn_clamp": [-40, 40],
    "score_clamp": [0, 100],
    "max_matches_per_category": 2,
    "silence_penalty": 6,
    "negation_window_chars": 7,
    "intensifier_multiplier": 1.5,
    "bands": {"low": [0, 33], "medium": [34, 66], "high": [67, 100]},
}


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
        silence_streak: 연속 무발화/최소응답 횟수 (2턴↑ → +silence_penalty).

    Returns:
        (churn_after, tokens)
    """
    lex = _lexicon()
    model = lex["model"]
    text = _normalize(customer_text)

    turn_raw = 0
    tokens: list[Token] = []

    for cat in lex["categories"]:
        matched = _match_category(text, cat, lex, model)
        if not matched:
            continue
        turn_raw += sum(w for _, w in matched)
        for stem, w in matched:
            tokens.append(
                Token(
                    text=stem,
                    polarity="CONS" if w > 0 else "PRO",
                    reason=cat.get("desc", cat["key"]),
                )
            )

    # 무발화/침묵 주저 신호 (CHURN-RISK-LEXICON §1 규칙6)
    if silence_streak >= 2:
        turn_raw += model["silence_penalty"]

    lo, hi = model["turn_clamp"]
    turn_raw = _clamp(turn_raw, lo, hi)

    s_lo, s_hi = model["score_clamp"]
    turn_score = _clamp(model["baseline"] + turn_raw, s_lo, s_hi)

    alpha = model["ema_alpha"]
    churn_after = round(alpha * turn_score + (1 - alpha) * churn_before)

    # LLM 보정은 ±10 한도로만 (사전 점수가 1차 진실)
    churn_after += _clamp(adjust, -10, 10)
    return _clamp(churn_after, s_lo, s_hi), tokens


def band(churn: int) -> str:
    """게이지 밴드 (CHURN-RISK-LEXICON §0)."""
    bands = _lexicon()["model"]["bands"]
    if churn <= bands["low"][1]:
        return "low"
    if churn <= bands["medium"][1]:
        return "medium"
    return "high"


# ─────────────────────────────────────────────────────────────────────────────
# 매칭 내부
# ─────────────────────────────────────────────────────────────────────────────


def _match_category(text: str, cat: dict, lex: dict, model: dict) -> list[tuple[str, int]]:
    """한 카테고리에서 매칭된 (stem, signed_weight) 목록 (최대 max_matches_per_category개)."""
    base_weight = cat["weight"]  # cons>0, pro<0
    max_matches = model["max_matches_per_category"]
    neg_window = model["negation_window_chars"]
    mult = model["intensifier_multiplier"]
    neg_terms = lex["negation_terms"]
    int_terms = lex["intensifier_terms"]

    results: list[tuple[str, int]] = []
    for stem in cat["stems"]:
        norm_stem = _normalize(stem)
        idx = text.find(norm_stem)
        if idx == -1:
            continue

        w = base_weight
        # 부정/강조 판정은 stem 바로 앞 "어절"로 한정한다.
        # 평면 N자 윈도우는 여러 어절을 건너뛰어 무관한 부정어를 오검출한다
        # (예: "관심없어요 그냥 끊을게" → '없'이 '끊을게'를 잘못 반전). §매칭규칙 참조.
        prefix = text[max(0, idx - neg_window):idx].strip()
        last_eojeol = prefix.rsplit(" ", 1)[-1] if prefix else ""
        # 부정 반전: 바로 앞 어절에 부정어 → 부호 반전
        if any(nt in last_eojeol for nt in neg_terms):
            w = -w
        # 강조 배수: 바로 앞 어절에 강조어 → ×mult
        if any(it in last_eojeol for it in int_terms):
            w = round(w * mult)

        results.append((stem, w))
        if len(results) >= max_matches:
            break

    return results


def _normalize(text: str) -> str:
    """공백 정규화 + 소문자화. (한글은 영향 없음, 영문/숫자 케이스 통일)"""
    return re.sub(r"\s+", " ", (text or "").strip()).lower()


def _clamp(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, int(v)))


@lru_cache(maxsize=1)
def _lexicon() -> dict:
    """렉시콘 로드 (1회 캐시). 런타임 경로 → 실패 시 model 폴백만으로 동작."""
    try:
        with open(_LEXICON_PATH, encoding="utf-8") as f:
            lex = json.load(f)
        lex.setdefault("model", _DEFAULT_MODEL)
        lex.setdefault("negation_terms", [])
        lex.setdefault("intensifier_terms", [])
        lex.setdefault("categories", [])
        return lex
    except (OSError, json.JSONDecodeError):
        logger.exception("lexicon load failed at %s; using empty lexicon", _LEXICON_PATH)
        return {
            "model": _DEFAULT_MODEL,
            "negation_terms": [],
            "intensifier_terms": [],
            "categories": [],
        }
