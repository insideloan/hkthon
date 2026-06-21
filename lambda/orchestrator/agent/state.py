"""LangGraph 상태 타입 / CallState and supporting types.

AGENT 모듈 SSOT for the in-graph state. 설계: docs/agent/LANGGRAPH-DESIGN.md §3.

라이브 모드에서 그래프 노드 간 전달되는 단일 상태. Lambda는 stateless이므로 매 nextTurn마다
context.load_call_state()가 DynamoDB에서 이 상태를 재구성한다(checkpointer 미사용).
"""

from __future__ import annotations

from enum import Enum
from typing import Literal, Optional, TypedDict

from .signals import Emotion, Need, Usability


# ─────────────────────────────────────────────────────────────────────────────
# Enums — 단계 / 의도 / 라우팅
# ─────────────────────────────────────────────────────────────────────────────


class Stage(str, Enum):
    """xlsx 4단계 (LANGGRAPH-DESIGN §0.1). ARCHITECTURE.md S1 노드와 매핑."""

    IDENTIFY = "IDENTIFY"      # STEP 1 신원고지/녹취고지  (≈ GREETING)
    CONSENT = "CONSENT"        # STEP 2 동의/목적안내       (≈ INTRO_PRODUCT)
    PROPOSE = "PROPOSE"        # STEP 3 상품제안            (≈ HANDLE_OBJECTION + OFFER_SIGNUP)
    CHANNEL = "CHANNEL"        # STEP 4 채널선택            (≈ OFFER_SIGNUP 종단)
    CLOSING = "CLOSING"        # 종료 마무리


class Intent(str, Enum):
    """정규화된 고객 의도 (LANGGRAPH-DESIGN §4.2). xlsx Intent 열 → 단계 횡단 분류."""

    IDENTITY_CONFIRMED = "IDENTITY_CONFIRMED"
    IDENTITY_FAILED = "IDENTITY_FAILED"
    RECORDING_REFUSED = "RECORDING_REFUSED"
    CONSENT_GIVEN = "CONSENT_GIVEN"
    INTEREST = "INTEREST"
    QUESTION_TERMS = "QUESTION_TERMS"        # 금리/한도/조건/리스크/비용 질문
    FRAUD_DOUBT = "FRAUD_DOUBT"              # 보이스피싱 의심 (+fraud 플래그)
    TRANSFER_INTENT = "TRANSFER_INTENT"      # 상담원 연결 요청
    LIMIT_INQUIRY = "LIMIT_INQUIRY"          # 한도조회 (성공경로 → transfer)
    BUYING_INTENT = "BUYING_INTENT"          # 셀프 디지털 진행
    OPT_OUT = "OPT_OUT"                      # 마케팅 동의 철회
    REJECTION = "REJECTION"                  # 명시적 거절/즉시종료/욕설
    DEFER = "DEFER"                          # 나중에/가족상의/바쁨
    SILENCE = "SILENCE"                      # 무응답/침묵
    UNCLEAR = "UNCLEAR"                      # 룰로 판단 불가 → LLM 위임


class Route(str, Enum):
    """다음 노드 라우팅 결정 (LANGGRAPH-DESIGN §5)."""

    RESPOND = "RESPOND"        # 정상 응답 생성
    TRANSFER = "TRANSFER"      # 상담원 이관 → TRANSFER_PENDING
    CLOSE = "CLOSE"            # 정중히 종료
    SILENCE = "SILENCE"        # 10초 재확인
    NEEDS_LLM = "NEEDS_LLM"    # fast_route가 판단 못 함 → classify 노드로


class CallStatus(str, Enum):
    """통화 수명주기 상태 (persist가 Call 아이템에 반영). 라우팅(Route)과 별개의 축이다.

    - ACTIVE: 통화 진행 중 (기본값)
    - TRANSFER_PENDING: 상담원 이관 대기 (transfer_node 진입 → 성공경로)
    - ENDED: 통화 종료 (close_node / silence 2회↑)
    fraud_suspected는 상태가 아니라 플래그(통화를 종료/전이시키지 않음).
    """

    ACTIVE = "ACTIVE"
    TRANSFER_PENDING = "TRANSFER_PENDING"
    ENDED = "ENDED"


# ─────────────────────────────────────────────────────────────────────────────
# 보조 구조체 (TypedDict)
# ─────────────────────────────────────────────────────────────────────────────


class CustomerCtx(TypedDict, total=False):
    """고객 컨텍스트 (DynamoDB Customer 아이템 투영)."""

    customer_id: str
    name: str
    target_product: str
    rate: float
    limit: int
    existing_loans: list[dict]   # 당사/타사
    has_vehicle: bool
    credit_score: int
    persona_json: dict


class TurnMsg(TypedDict):
    """history에 담기는 직전 턴 요약."""

    seq: int
    speaker: Literal["customer", "bot", "agent"]
    text: str
    node: Optional[str]


class Token(TypedDict):
    """SpeechAnalysis 카드용 키워드 토큰 (churn 매칭 결과)."""

    text: str
    polarity: Literal["PRO", "CONS"]
    reason: str


class ComplianceStep(TypedDict):
    """Guardrails 루프 단계 로그 (onComplianceState)."""

    state: Literal["drafting", "reviewing", "redacting", "redrafting", "approved"]
    draft: str
    verdict: Optional[str]
    violated_policies: list[str]
    try_no: int


class Strategy(TypedDict, total=False):
    """StrategyPanel용 전략. tactic은 signals.Tactic 라벨(20종 정규값)."""

    tactic: str       # signals.Tactic.value (카탈로그 밖이면 분류 폴백)
    headline: str


class MotResult(TypedDict, total=False):
    """detect_mot 판정 결과 (MOT 아이템 투영)."""

    type: Literal["RISK", "CONVERSION"]
    turn_seq: int
    churn_before: int
    churn_after: int
    triggers: list[str]
    strategy: Strategy
    outcome: Literal["defended", "converted", "lost"]
    narrative: str


# ─────────────────────────────────────────────────────────────────────────────
# CallState — LangGraph 메인 상태
# ─────────────────────────────────────────────────────────────────────────────


class CallState(TypedDict, total=False):
    """그래프 노드 간 전달되는 단일 상태. 필드별 채우는 노드는 LANGGRAPH-DESIGN §3 표 참조."""

    # load_context
    call_id: str
    customer: CustomerCtx
    stage: Stage
    history: list[TurnMsg]
    customer_text: str
    churn_before: int
    next_seq: int
    call_status: CallStatus   # 통화 수명주기 (기본 ACTIVE; transfer→TRANSFER_PENDING, 종단→ENDED)

    # fast_route / classify
    intent: Intent
    route: Route
    classified_by: Literal["rule", "llm"]
    emotion: Optional[Emotion]       # 신호축1 (signals.Emotion, 15종)
    need: Optional[Need]             # 신호축2 (signals.Need, 15종)
    usability: Optional[Usability]   # 신호축3 (signals.Usability, 20종)
    fraud_suspected: bool
    strategy: Strategy
    rationale: str

    # churn_score
    churn_after: int
    churn_tokens: list[Token]

    # respond / compliance
    bot_draft: str
    bot_text: str
    compliance_log: list[ComplianceStep]

    # detect_mot
    mot: Optional[MotResult]
