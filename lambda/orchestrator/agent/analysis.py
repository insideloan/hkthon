"""발화 분석 / Speech analysis — 키워드 polarity+reason 토큰화.

AGENT 모듈 (AGENT-011, #19). SSOT: hk-skills/reference/CHURN-RISK-LEXICON.md.

목적: 고객 발화를 어절 단위 토큰으로 분해해 SpeechAnalysis 카드(초록/빨강 키워드 +
확장 사유)의 데이터를 생산한다. DynamoDB `Turn.tokens` → Streams → `onSpeechAnalysis` 팬아웃.

churn_risk와의 관계:
  - churn_risk.score()는 "점수 계산"이 목적 → 매칭 키워드만 토큰화.
  - 이 모듈은 "발화 시각화"가 목적 → 매칭 키워드(PRO/CONS) + 비키워드 어절(polarity=None)
    까지 전체 토큰을 반환한다.
  - 사전 로드/매칭/부정 규칙은 churn_risk 내부 함수를 재사용한다(렉시콘 SSOT 일원화).
"""

from __future__ import annotations

from . import churn_risk
from .state import Token


def analyze(customer_text: str) -> list[Token]:
    """고객 발화 → 어절 단위 토큰 목록.

    각 어절(공백 분리)에 대해:
      - 렉시콘 stem을 포함하면 polarity=PRO/CONS + reason=카테고리 desc
      - 아니면 polarity=None + reason="" (비키워드)

    PRO/CONS는 churn_risk와 동일 규칙(카테고리 weight 부호 + 바로 앞 어절 부정어 반전)으로
    결정한다. 같은 어절이 여러 카테고리에 걸리면 먼저 매칭된 카테고리를 따른다.

    Args:
        customer_text: STT 고객 발화 (ko-KR).

    Returns:
        발화 순서를 보존한 Token 목록. 빈 입력이면 빈 목록.
    """
    norm = churn_risk._normalize(customer_text)
    if not norm:
        return []

    # 1) 렉시콘 매칭: 문장 내 매칭 구간 [start,end) → (polarity, reason). churn_risk 규칙 재사용.
    #    stem이 다중 어절(공백 포함)일 수 있으므로 문자 인덱스 구간으로 다룬다.
    spans = _matched_spans(norm)

    # 2) 어절 단위로 토큰화하며, 어절이 매칭 구간과 겹치면 polarity를 입힌다(발화 순서 보존).
    tokens: list[Token] = []
    cursor = 0
    for eojeol in norm.split(" "):
        if not eojeol:
            cursor += 1  # 연속 공백 보정
            continue
        start = norm.index(eojeol, cursor)
        end = start + len(eojeol)
        cursor = end
        polarity, reason = _classify_span(start, end, spans)
        tokens.append(Token(text=eojeol, polarity=polarity, reason=reason))
    return tokens


def _matched_spans(norm_text: str) -> list[tuple[int, int, str, str]]:
    """정규화된 발화에서 매칭된 구간 목록 [(start, end, polarity, reason), ...].

    churn_risk._match_category(부정 반전·카테고리당 max_matches 규칙 포함)로 매칭 stem을 얻고,
    각 stem의 문장 내 위치를 구간으로 환산한다. 같은 구간 중복은 먼저 매칭된 카테고리 우선.
    """
    lex = churn_risk._lexicon()
    model = lex["model"]
    spans: list[tuple[int, int, str, str]] = []
    for cat in lex["categories"]:
        reason = cat.get("desc", cat["key"])
        for stem, signed_w in churn_risk._match_category(norm_text, cat, lex, model):
            norm_stem = churn_risk._normalize(stem)
            idx = norm_text.find(norm_stem)
            if idx == -1:
                continue
            # 부호 반전(부정어)까지 반영된 signed_w로 polarity 결정. cons>0 → CONS.
            polarity = "CONS" if signed_w > 0 else "PRO"
            spans.append((idx, idx + len(norm_stem), polarity, reason))
    return spans


def _classify_span(start: int, end: int, spans: list[tuple[int, int, str, str]]):
    """어절 구간 [start,end)이 매칭 구간과 겹치면 (polarity, reason), 아니면 (None, "")."""
    for s_start, s_end, polarity, reason in spans:
        if start < s_end and s_start < end:  # 구간 겹침
            return polarity, reason
    return None, ""
