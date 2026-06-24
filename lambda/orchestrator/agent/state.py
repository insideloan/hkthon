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
    TRANSFER_INTENT = "TRANSFER_INTENT"      # 상담원 요청 → AI 본심사 접수로 전환(사람 이관 폐기)
    LIMIT_INQUIRY = "LIMIT_INQUIRY"          # 한도조회 (성공경로 → AI 본심사 접수)
    BUYING_INTENT = "BUYING_INTENT"          # 셀프 디지털 진행
    OPT_OUT = "OPT_OUT"                      # 마케팅 동의 철회
    REJECTION = "REJECTION"                  # 명시적 거절/즉시종료/욕설
    DEFER = "DEFER"                          # 나중에/가족상의/바쁨
    SILENCE = "SILENCE"                      # 무응답/침묵
    UNCLEAR = "UNCLEAR"                      # 룰로 판단 불가 → LLM 위임


class Route(str, Enum):
    """다음 노드 라우팅 결정 (LANGGRAPH-DESIGN §5)."""

    RESPOND = "RESPOND"        # 정상 응답 생성
    TRANSFER = "TRANSFER"      # AI 본심사 접수(intake_node)로 전환 — 사람 이관 아님(통화 ACTIVE 유지)
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
    """SpeechAnalysis 카드용 발화 토큰.

    churn 매칭 키워드는 polarity=PRO/CONS + reason(카테고리), 비키워드 토큰은
    polarity=None + reason="" (AGENT-011 발화 분석). onSpeechAnalysis 팬아웃용.
    """

    text: str
    polarity: Optional[Literal["PRO", "CONS"]]
    reason: str


class ComplianceStep(TypedDict, total=False):
    """Guardrails 루프 단계 로그 (onComplianceState).

    draft         = 해당 단계의 현재 텍스트(원문/차단본/재작성본).
    final_text    = approved 단계에서만 채워지는 최종 확정 발화. FRONTEND가
                    draft(원문)와 final_text(최종)를 diff로 렌더(SSOT-3 cmpFinal).
                    그 외 단계에서는 None.
    """

    state: Literal["drafting", "reviewing", "redacting", "redrafting", "approved"]
    draft: str
    verdict: Optional[str]
    violated_policies: list[str]
    try_no: int
    final_text: Optional[str]


class Strategy(TypedDict, total=False):
    """카드①(SSOT-3 #stratGrid / STRAT20)용 전략. tactic은 signals.Tactic 라벨(20종 정규값).

    FRONTEND 매핑: headline=카드 제목(.stx), lead=카드 부연 한 문장(.slead).
    """

    tactic: str       # signals.Tactic.value (카탈로그 밖이면 분류 폴백)
    headline: str     # 전략 제목 — 카드 .stx
    lead: str         # 전략 부연 한 문장 — 카드 .slead (signals.TACTIC_LEAD 정본)


class MotResult(TypedDict, total=False):
    """detect_mot 판정 결과 (MOT 아이템 투영).

    SSOT: docs/consult_redesigned-3.html. BACKEND #28 계약 준수.
    - motId: MOT_1~MOT_5 (markerId enum, wire 값)
    - state: SHOW|ALERT|BLOCKED (대문자 wire 값)
    - stageIndex: 0(TRUST)~3(CLOSE) — sum-flow 4단계 매핑
    - is_conversion: TRANSFER_INTENT/BUYING_INTENT 전환 여부

    폐기 필드 (SSOT-3 기준): type, narrative, strategy, outcome,
    churnBefore(snake: churn_before 그대로), churnAfter(직접 출력 제거).
    """

    motId: str                                      # "MOT_1".."MOT_5"
    turn_seq: int
    churn_before: int
    churn_after: int
    triggers: list[str]
    state: Literal["SHOW", "ALERT", "BLOCKED"]
    stageIndex: int                                 # 0=TRUST,1=OBJECTION,2=COLLATERAL,3=CLOSE
    is_conversion: bool


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
    handoff_summary: str   # (레거시) 수동 상담원 이관용 핸드오프 요약 — 자동 흐름 미사용
    result_type: str       # intake_node가 채움: "AI_본심사" — onCallEnded resultType 분류용
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
    _blind_draft: Optional[str]   # speculative/fused 모드: classify 단계에서 미리 생성한 draft
    _compliance_confidence: Optional[float]  # fused 모드: 모델 자가평가 금소법 준수 신뢰도(0~1)
    compliance_log: list[ComplianceStep]
    audio_url: Optional[str]   # persist가 채움: 봇 발화 TTS mp3 presigned URL (라이브 모드)

    # detect_mot
    mot: Optional[MotResult]
