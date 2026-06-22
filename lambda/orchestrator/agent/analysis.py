"""발화 분석 / Speech analysis — 어절 토큰화 + 턴 레벨 flag 산출.

AGENT 모듈. SSOT: docs/consult_redesigned-3.html (SSOT-3 재정렬).
렉시콘 SSOT: hk-skills/reference/CHURN-RISK-LEXICON.md.

역할:
  - 고객 발화를 어절 단위로 전체 토큰화:
      매칭 키워드 → polarity=PRO/CONS + reason=카테고리 desc.
      비키워드 어절 → polarity=None + reason="" (발화 시각화).
  - churn_risk 내부 함수(사전 로드·매칭·부정 규칙)를 재사용해 렉시콘 SSOT 일원화.
  - churn_score()로 이탈위험도(EMA) 갱신.
  - 턴 레벨 flag ("risk" | "def" | null) 산출 → Turn.flag으로 기록.
      ※ BACKEND #28 계약: null → NEUTRAL 으로 매핑해 방출.

SSOT-3 재정렬 (2026-06-22):
  ✗ 폐기: polarity → 키워드 색상 클래스(k-go / k-risk) 드라이빙 역할.
           .bubble .kw 의 색상·배경·깜빡임은 SSOT-3에서 전부 제거됨.
  ✓ 변경: polarity는 턴 단위 flag 배지 분기용 (.flag--risk / .flag--def).
           reason은 전략 카드 lead(.slead)로 FRONTEND에서 노출(생산 방식 불변).
  ✓ 유지: 토큰 shape {text, polarity, reason}, polarity 값 집합 "PRO"|"CONS"|null,
           DynamoDB Turn.tokens → onSpeechAnalysis 팬아웃 계약.

턴 레벨 flag 산출 규칙 (SSOT-3 §flag 배지 분기):
  "risk" — CONS 토큰이 1개 이상 존재하고 PRO 토큰보다 많을 때
            (위험 신호가 방어 신호를 초과하는 위험 턴).
  "def"  — PRO 토큰이 1개 이상 존재하고 CONS 토큰보다 많거나 같을 때
            (방어·성공경로 신호가 우세한 방어 턴).
  null   — 토큰 없음 또는 위 조건 미해당 (중립 턴).
"""

from __future__ import annotations

from typing import Literal, Optional

from . import churn_risk
from .churn_risk import score as churn_score
from .state import Token

# ─────────────────────────────────────────────────────────────────────────────
# 공개 타입
# ─────────────────────────────────────────────────────────────────────────────

TurnFlag = Optional[Literal["risk", "def"]]
"""턴 레벨 flag.

"risk" — 위험 턴 (.flag--risk, 빨강 배지)
"def"  — 방어 턴 (.flag--def, 초록 배지)
None   — 중립 턴 (BACKEND 계약: NEUTRAL)

SSOT-3: polarity는 키워드 색상 클래스(k-go/k-risk)를 드라이빙하지 않음.
        flag 배지 분기 전용으로 역할이 재정의됨.
"""


# ─────────────────────────────────────────────────────────────────────────────
# 핵심 함수
# ─────────────────────────────────────────────────────────────────────────────


def analyze(
    customer_text: str,
    churn_before: int,
    *,
    adjust: int = 0,
    silence_streak: int = 0,
) -> tuple[int, list[Token], TurnFlag]:
    """고객 발화를 분석해 churn 갱신값·토큰 목록·턴 flag를 반환.

    토큰 목록은 어절 전체를 포함한다(비키워드 어절도 polarity=None으로 반환).
    churn 점수 계산은 churn_score()를 재사용하고, 토큰화는 어절 전체를 처리한다.

    Args:
        customer_text: STT 고객 발화 (ko-KR).
        churn_before: 직전 턴 churn_risk (EMA용).
        adjust: classify LLM 보정 제안 (±10 한도, 사전 점수 우선).
        silence_streak: 연속 무발화/최소응답 횟수.

    Returns:
        (churn_after, tokens, turn_flag)
        - churn_after: 이번 턴 이탈위험도 (0~100).
        - tokens: [{text, polarity, reason}] — DynamoDB Turn.tokens.
          매칭 키워드는 PRO/CONS + reason, 비키워드는 polarity=None + reason="".
        - turn_flag: "risk" | "def" | None — DynamoDB Turn.flag.
    """
    churn_after, _score_tokens = churn_score(
        customer_text,
        churn_before,
        adjust=adjust,
        silence_streak=silence_streak,
    )
    # 어절 전체 토큰화 (비키워드 어절도 포함, 발화 시각화 목적)
    tokens = _tokenize_all_eojeol(customer_text)
    flag = derive_turn_flag(tokens)
    return churn_after, tokens, flag


def derive_turn_flag(tokens: list[Token]) -> TurnFlag:
    """토큰 목록에서 턴 레벨 flag를 산출.

    판정 규칙 (SSOT-3 §flag 배지 분기):
      - CONS > 0 이고 CONS > PRO  → "risk"
      - PRO  > 0 이고 PRO >= CONS → "def"
      - 그 외 (토큰 없음 등)        → None (NEUTRAL)

    ※ polarity가 None인 토큰은 집계에서 제외.
    """
    cons_count = sum(1 for t in tokens if t.get("polarity") == "CONS")
    pro_count = sum(1 for t in tokens if t.get("polarity") == "PRO")

    if cons_count > 0 and cons_count > pro_count:
        return "risk"
    if pro_count > 0 and pro_count >= cons_count:
        return "def"
    return None


# ─────────────────────────────────────────────────────────────────────────────
# 내부 헬퍼 — 어절 전체 토큰화 (발화 시각화 로직)
# ─────────────────────────────────────────────────────────────────────────────


def _tokenize_all_eojeol(customer_text: str) -> list[Token]:
    """고객 발화 → 어절 단위 전체 토큰 목록.

    각 어절(공백 분리)에 대해:
      - 렉시콘 stem을 포함하면 polarity=PRO/CONS + reason=카테고리 desc
      - 아니면 polarity=None + reason="" (비키워드)

    PRO/CONS는 churn_risk와 동일 규칙(카테고리 weight 부호 + 바로 앞 어절 부정어 반전)으로
    결정한다. 같은 어절이 여러 카테고리에 걸리면 먼저 매칭된 카테고리를 따른다.
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
