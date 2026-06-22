"""발화 분석 / Speech analysis — 토큰 + 턴 레벨 flag 산출.

AGENT 모듈. SSOT: docs/consult_redesigned-3.html (SSOT-3 재정렬).

역할:
  - 고객 발화 텍스트에서 토큰 [{text, polarity, reason}] 생산.
  - churn_risk 렉시콘 매칭 결과를 바탕으로 토큰 polarity 결정:
      CONS (위험/이탈 신호, weight > 0) / PRO (성공경로 신호, weight < 0) / null (비매칭).
  - 턴 레벨 flag ("risk" | "def" | null) 별도 산출 → Turn.flag으로 기록.
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

    Args:
        customer_text: STT 고객 발화 (ko-KR).
        churn_before: 직전 턴 churn_risk (EMA용).
        adjust: classify LLM 보정 제안 (±10 한도, 사전 점수 우선).
        silence_streak: 연속 무발화/최소응답 횟수.

    Returns:
        (churn_after, tokens, turn_flag)
        - churn_after: 이번 턴 이탈위험도 (0~100).
        - tokens: [{text, polarity, reason}] — DynamoDB Turn.tokens.
        - turn_flag: "risk" | "def" | None — DynamoDB Turn.flag.
    """
    churn_after, tokens = churn_score(
        customer_text,
        churn_before,
        adjust=adjust,
        silence_streak=silence_streak,
    )
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
