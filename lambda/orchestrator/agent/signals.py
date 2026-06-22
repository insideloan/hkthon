"""신호 분류 체계 / Signal taxonomy (SSOT).

AGENT 모듈. SSOT: docs/상담엔진_ver1.xlsx 시트 "상담엔진 신호".
설계: docs/agent/LANGGRAPH-DESIGN.md §4.2(분류) 보강.

통화_에이전트 xlsx가 "단계 흐름(세로축)"이라면, 이 모듈은 매 고객 발화를 읽는
"신호(가로축)"다. 4개 축(감정/니즈/이용가능성/전략)을 엄격한 Enum으로 고정해
classify 노드의 LLM이 카탈로그 밖 값을 내면 폴백되도록 한다(데모 일관성·관리자 화면 안정).

각 Enum 멤버의 value = 한국어 라벨(관리자 화면/카드 노출용). 코드 키는 영문 stem.
정의(상세)와 대표 발화는 CATALOG 메타에 보관해 프롬프트 주입에 사용한다.
"""

from __future__ import annotations

from enum import Enum


# ─────────────────────────────────────────────────────────────────────────────
# 축 1) 감정 (Emotion) — xlsx 15종
# ─────────────────────────────────────────────────────────────────────────────


class Emotion(str, Enum):
    """고객 감정 상태 (xlsx '감정' 표, 15종)."""

    INDIFFERENT = "무관심"   # 1  설명 들을 의지 낮고 빨리 끝내려 함
    WARY = "경계"            # 2  전화 출처/목적 의심, 방어적
    DOUBTFUL = "의심"        # 3  내용·조건·혜택이 사실인지 불신
    ANXIOUS = "불안"         # 4  신용점수/개인정보/승인 등 불이익 걱정
    BURDENED = "부담"        # 5  이자·월납입 감당 어렵다고 느낌
    INTERESTED = "관심"      # 6  조건을 더 들어볼 의향 생김
    COMPARING = "비교"       # 7  기존·타사·다른 상품과 따져보려 함
    URGENT = "긴급"          # 8  자금이 빠르게 필요, 시간 압박
    RELIEVED = "안도"        # 9  설명 듣고 걱정/방어감 일부 낮아짐
    ACCEPTING = "수용"       # 10 다음 단계 동의·확인 의사
    SKEPTICAL = "회의"       # 11 혜택·필요성 실효성 낮다고 봄
    AVERSE = "거부감"        # 12 대출·영업 전화·권유 자체에 부정적
    ANNOYED = "짜증"         # 13 반복 연락·긴 설명·절차로 감정적 불편
    EXPECTANT = "기대"       # 14 더 좋은 조건/절감 효과 기대
    HESITANT = "망설임"      # 15 관심은 있으나 확신 없어 보류


# ─────────────────────────────────────────────────────────────────────────────
# 축 2) 니즈 (Need) — xlsx 15종
# ─────────────────────────────────────────────────────────────────────────────


class Need(str, Enum):
    """고객 니즈 (xlsx '니즈' 표, 15종)."""

    LIMIT = "한도 확인"             # 1
    LOWER_PAYMENT = "월납입 절감"    # 2
    RATE_COMPARE = "금리 비교"       # 3
    REFINANCE = "대환 가능성"        # 4
    EXTRA_FUND = "추가 자금"         # 5
    APPROVAL = "승인 가능성"         # 6
    CREDIT_IMPACT = "신용 영향"      # 7
    PROCESS_DOCS = "절차/서류"       # 8
    REPAY_TERMS = "상환 조건"        # 9
    OPT_OUT = "연락 중단/수신거부"    # 10
    IDENTITY = "본인 확인"           # 11
    PRODUCT = "상품 확인"            # 12
    ELIGIBILITY = "자격 조건"        # 13
    SPEED = "실행 속도"              # 14
    SAFETY = "안전성 확인"           # 15


# ─────────────────────────────────────────────────────────────────────────────
# 축 3) 이용 가능성 (Usability) — xlsx 20종
# ─────────────────────────────────────────────────────────────────────────────


class Usability(str, Enum):
    """이용 가능성 — 다음 단계 진행 가능성 (xlsx '이용 가능성' 표, 20종)."""

    PROCEED_NOW = "즉시 진행 가능"           # 1
    CONDITIONAL = "조건부 진행"              # 2
    AFTER_LIMIT = "한도 확인 후 판단"         # 3
    AFTER_RATE = "금리 확인 후 판단"          # 4
    AFTER_PAYMENT = "월납입 확인 후 판단"      # 5
    AFTER_COMPARE = "기존 대출 비교 후 판단"   # 6
    NEEDS_FAMILY = "가족/배우자 상의 필요"     # 7
    NO_TIME = "시간 부족"                    # 8
    CALLBACK_OK = "재통화 가능"              # 9
    NEEDS_EXPLAIN = "설명 추가 필요"          # 10
    NEEDS_TRUST = "신뢰 확보 필요"           # 11
    PRIVACY_CONCERN = "개인정보 우려"         # 12
    CREDIT_CONCERN = "신용조회 우려"          # 13
    LOAN_REFUSED = "대출 거부"               # 14
    PRODUCT_MISMATCH = "상품 부적합"          # 15
    ELIGIBILITY_UNSURE = "자격 불확실"        # 16
    URGENT_EXEC = "긴급 실행 희망"            # 17
    BENEFIT_DRIVEN = "혜택 기대 진행"         # 18
    NEEDS_AGENT = "상담원 연결 필요"          # 19
    COMPLIANCE_STOP = "컴플라이언스 중단 필요"  # 20


# ─────────────────────────────────────────────────────────────────────────────
# 축 4) 전략 (Strategy tactic) — xlsx 20종
# ─────────────────────────────────────────────────────────────────────────────


class Tactic(str, Enum):
    """대표 대응 전략 (xlsx '전략' 표, 20종). StrategyPanel.tactic의 정규 값."""

    AROUSE_INTEREST = "관심 환기 전략"        # 1
    BUILD_TRUST = "신뢰 확보 전략"           # 2
    CLARIFY_PRODUCT = "상품 확인 전략"        # 3
    RESOLVE_DOUBT = "의심 해소 전략"          # 4
    EMPATHIZE_PIVOT = "공감 후 전환 전략"      # 5
    EASE_ANXIETY = "불안 완화 전략"           # 6
    EASE_BURDEN = "부담 완화 전략"            # 7
    EXPLORE_LIMIT = "한도 탐색 전략"          # 8
    COMPARE_RATE = "금리 비교 전략"           # 9
    PROPOSE_REFINANCE = "대환 제안 전략"      # 10
    EXTRA_FUND = "추가 자금 전략"            # 11
    CHECK_APPROVAL = "승인 가능성 확인 전략"   # 12
    CHECK_ELIGIBILITY = "자격 조건 확인 전략"  # 13
    SIMPLIFY_PROCESS = "절차 간소화 전략"      # 14
    EXPLAIN_REPAY = "상환 조건 설명 전략"      # 15
    SUPPORT_COMPARE = "비교 검토 지원 전략"    # 16
    URGENT_EXEC = "긴급 실행 전략"            # 17
    SCHEDULE_CALLBACK = "재통화 예약 전략"     # 18
    RESPECT_REJECTION = "거절 존중 전략"      # 19
    HANDOFF_PROTECT = "상담원 인계·컴플라이언스 보호 전략"  # 20


# ─────────────────────────────────────────────────────────────────────────────
# 카탈로그 메타 (상세 정의 + 대표 발화) — 프롬프트 주입용
#   xlsx '상세 정의' / '대표 발화' 열 원문 인용.
# ─────────────────────────────────────────────────────────────────────────────

EMOTION_DEF: dict[Emotion, tuple[str, str]] = {
    Emotion.INDIFFERENT: ("상품 설명을 들을 의지가 낮고 통화를 빨리 끝내려는 상태", "괜찮아요. 필요 없어요."),
    Emotion.WARY: ("전화의 출처나 목적을 의심하며 방어적으로 반응하는 상태", "어디서 전화하신 거예요?"),
    Emotion.DOUBTFUL: ("안내 내용, 조건, 혜택이 사실인지 믿지 못하는 상태", "그렇게 좋은 조건이면 왜 저한테 전화해요?"),
    Emotion.ANXIOUS: ("신용점수, 개인정보, 승인 여부 등 불이익을 걱정하는 상태", "조회하면 신용점수 떨어지는 거 아니에요?"),
    Emotion.BURDENED: ("대출 실행 후 이자나 월 납입을 감당하기 어렵다고 느끼는 상태", "매달 갚는 게 더 늘어나면 부담돼요."),
    Emotion.INTERESTED: ("조건을 더 들어볼 의향이 생긴 상태", "대략 어떤 조건인지 들어볼게요."),
    Emotion.COMPARING: ("기존 대출, 타 금융사, 다른 상품과 따져보려는 상태", "지금 쓰는 대출보다 나은 거예요?"),
    Emotion.URGENT: ("자금이 빠르게 필요해 시간 압박이 큰 상태", "오늘 안에 가능해야 하는데요."),
    Emotion.RELIEVED: ("설명을 듣고 걱정이나 방어감이 일부 낮아진 상태", "아, 그런 절차면 괜찮네요."),
    Emotion.ACCEPTING: ("다음 단계 진행에 동의하거나 확인 의사를 보이는 상태", "그럼 한번 확인해보죠."),
    Emotion.SKEPTICAL: ("혜택이나 필요성에 대해 실효성이 낮다고 보는 상태", "해봤자 별 차이 없을 것 같은데요."),
    Emotion.AVERSE: ("대출, 영업 전화, 권유 자체에 부정적인 상태", "대출은 하고 싶지 않아요."),
    Emotion.ANNOYED: ("반복 연락, 긴 설명, 절차로 인해 감정적으로 불편한 상태", "몇 번을 전화하는 거예요?"),
    Emotion.EXPECTANT: ("더 좋은 조건이나 절감 효과가 있을 수 있다고 기대하는 상태", "정말 월 납입이 줄면 괜찮겠네요."),
    Emotion.HESITANT: ("관심은 있으나 결정에 확신이 없어 보류하려는 상태", "생각은 해볼게요."),
}

NEED_DEF: dict[Need, tuple[str, str]] = {
    Need.LIMIT: ("본인이 받을 수 있는 최대 가능 금액을 알고 싶어함", "얼마까지 나와요?"),
    Need.LOWER_PAYMENT: ("매달 나가는 상환액을 줄이고 싶어함", "월 납입이 지금보다 줄 수 있나요?"),
    Need.RATE_COMPARE: ("금리 수준이 유리한지 확인하고 싶어함", "금리는 몇 퍼센트예요?"),
    Need.REFINANCE: ("기존 대출을 더 나은 조건으로 갈아탈 수 있는지 확인", "지금 쓰는 대출을 바꿀 수 있어요?"),
    Need.EXTRA_FUND: ("새로 필요한 자금을 확보하고 싶어함", "추가로 쓸 돈이 좀 필요해요."),
    Need.APPROVAL: ("본인의 조건으로 심사 통과 가능성이 있는지 궁금해함", "제 신용으로도 가능할까요?"),
    Need.CREDIT_IMPACT: ("조회나 대출 실행이 신용점수에 미치는 영향을 알고 싶어함", "조회만 해도 기록 남나요?"),
    Need.PROCESS_DOCS: ("신청 과정, 준비 서류, 진행 단계를 알고 싶어함", "신청하려면 뭐가 필요해요?"),
    Need.REPAY_TERMS: ("상환 기간, 방식, 중도상환 가능 여부를 확인하고 싶어함", "중간에 갚아도 되나요?"),
    Need.OPT_OUT: ("더 이상 전화나 안내를 받고 싶지 않아함", "다시는 전화하지 마세요."),
    Need.IDENTITY: ("상담 주체와 자신에게 연락한 이유를 확인하고 싶어함", "왜 저한테 연락하신 거예요?"),
    Need.PRODUCT: ("안내받는 상품의 종류와 기본 구조를 알고 싶어함", "무슨 대출 상품인데요?"),
    Need.ELIGIBILITY: ("차량 명의, 연식, 소득, 직장 등 가능 조건을 확인하고 싶어함", "차가 배우자 명의인데 가능해요?"),
    Need.SPEED: ("심사, 승인, 입금까지 걸리는 시간을 알고 싶어함", "언제 입금돼요?"),
    Need.SAFETY: ("보이스피싱 여부, 공식 절차, 개인정보 보호를 확인하고 싶어함", "이거 진짜 현대캐피탈 맞아요?"),
}

USABILITY_DEF: dict[Usability, tuple[str, str]] = {
    Usability.PROCEED_NOW: ("현재 통화에서 바로 확인이나 조회를 진행할 수 있음", "지금 바로 해볼게요."),
    Usability.CONDITIONAL: ("특정 조건이 맞으면 다음 단계로 갈 수 있음", "금리 괜찮으면 진행할게요."),
    Usability.AFTER_LIMIT: ("한도를 확인한 뒤 진행 여부를 결정하려 함", "한도 보고 결정할게요."),
    Usability.AFTER_RATE: ("금리 수준을 확인한 뒤 판단하려 함", "금리 보고 생각할게요."),
    Usability.AFTER_PAYMENT: ("월 상환액이 감당 가능한지 본 뒤 판단하려 함", "월 얼마인지 봐야겠네요."),
    Usability.AFTER_COMPARE: ("현재 이용 중인 대출보다 유리한지 비교가 필요함", "지금 대출이랑 비교해봐야죠."),
    Usability.NEEDS_FAMILY: ("본인 외 의사결정자가 있어 바로 결정하기 어려움", "남편이랑 상의해봐야 해요."),
    Usability.NO_TIME: ("지금은 통화를 이어가기 어려운 상태", "지금 회의 중이라 길게 못 해요."),
    Usability.CALLBACK_OK: ("지금은 어렵지만 나중에 다시 통화할 여지가 있음", "저녁에 다시 전화 주세요."),
    Usability.NEEDS_EXPLAIN: ("아직 이해가 부족해 추가 설명이 필요함", "그게 무슨 말인지 잘 모르겠어요."),
    Usability.NEEDS_TRUST: ("공식성이나 출처 확인이 되어야 다음 단계로 갈 수 있음", "문자로 먼저 보내주실 수 있어요?"),
    Usability.PRIVACY_CONCERN: ("개인정보 제공에 대한 부담 때문에 진행이 막힘", "주민번호 같은 걸 말해야 하나요?"),
    Usability.CREDIT_CONCERN: ("조회 기록이나 점수 하락 우려 때문에 진행을 망설임", "조회하면 신용에 안 좋은 거 아니에요?"),
    Usability.LOAN_REFUSED: ("대출 이용 의향이 없어 진행 가능성이 낮음", "대출은 안 할 거예요."),
    Usability.PRODUCT_MISMATCH: ("고객의 상황이나 니즈와 현재 상품이 맞지 않음", "저는 그런 상품은 필요 없어요."),
    Usability.ELIGIBILITY_UNSURE: ("조건 충족 여부가 불분명해 확인이 필요함", "소득 증빙이 없는데 가능해요?"),
    Usability.URGENT_EXEC: ("빠른 심사나 당일 실행이 핵심 조건임", "오늘 안 되면 의미 없어요."),
    Usability.BENEFIT_DRIVEN: ("혜택이 명확하면 진행할 가능성이 있음", "확실히 더 유리하면 해볼 수 있죠."),
    Usability.NEEDS_AGENT: ("AI 응대보다 사람 상담을 요구함", "사람 상담원으로 바꿔주세요."),
    Usability.COMPLIANCE_STOP: ("확정 안내, 과장 표현, 민감 정보 요구 등 리스크가 있어 중단 또는 인계 필요", "무조건 승인되는 거죠?"),
}

# 전략: (상세 정의, 대표 발화 방향) — respond 노드 헤드라인/가이드용
TACTIC_DEF: dict[Tactic, tuple[str, str]] = {
    Tactic.AROUSE_INTEREST: ("무관심 고객에게 긴 설명 대신 개인 관련성이 높은 한 문장으로 통화 지속 이유를 만든다", "고객님께 해당될 수 있는 조건인지 30초만 핵심만 안내드리겠습니다."),
    Tactic.BUILD_TRUST: ("통화 출처, 연락 사유, 공식 절차를 먼저 설명해 경계를 낮춘다", "현대캐피탈 상품 안내 목적으로 연락드렸고, 민감 정보는 요청드리지 않습니다."),
    Tactic.CLARIFY_PRODUCT: ("고객이 무엇을 안내받는지 모를 때 상품의 목적과 구조를 먼저 정리한다", "이번 안내는 기존 조건 확인 후 가능 여부를 보는 대출 상품 안내입니다."),
    Tactic.RESOLVE_DOUBT: ("혜택이나 조건을 과장하지 않고 확인 전/후 정보를 분리해 설명한다", "현재 단계에서는 확정 조건이 아니라 가능 여부를 확인하는 단계입니다."),
    Tactic.EMPATHIZE_PIVOT: ("고객 우려를 먼저 인정한 뒤 부담 낮은 다음 행동으로 연결한다", "바로 결정하실 필요는 없고, 조건만 먼저 확인해보실 수 있습니다."),
    Tactic.EASE_ANXIETY: ("신용, 개인정보, 승인 불안에 대해 안전 기준과 절차를 설명한다", "조회 방식과 신용 영향 여부를 먼저 안내드린 뒤 진행하겠습니다."),
    Tactic.EASE_BURDEN: ("상환 부담을 느끼는 고객에게 월 납입·기간·대환 관점으로 설명한다", "월 납입 부담이 줄어드는지부터 비교해보는 방식으로 보시면 됩니다."),
    Tactic.EXPLORE_LIMIT: ("한도 관심 고객에게 확정 표현 없이 가능 한도 확인 절차로 유도한다", "정확한 한도는 조회 후 확인되며, 가능 범위부터 확인하실 수 있습니다."),
    Tactic.COMPARE_RATE: ("금리에 민감한 고객에게 기존 조건 대비 비교 기준을 제시한다", "현재 이용 중인 금리와 비교해 유리한지 확인하는 방식이 좋습니다."),
    Tactic.PROPOSE_REFINANCE: ("기존 대출 보유 고객에게 갈아타기 가능성과 절감 효과를 확인시킨다", "기존 대출 대비 금리나 월 납입이 개선되는지 중심으로 안내드리겠습니다."),
    Tactic.EXTRA_FUND: ("추가 자금이 필요한 고객에게 필요 금액, 사용 시점, 상환 가능성을 확인한다", "필요하신 금액과 사용 시점을 기준으로 가능 상품을 확인해보겠습니다."),
    Tactic.CHECK_APPROVAL: ("고객 조건으로 진행 가능한지 기본 요건을 확인한다", "소득, 기존 대출, 차량 조건 등을 기준으로 가능 여부를 먼저 확인합니다."),
    Tactic.CHECK_ELIGIBILITY: ("명의, 연식, 소득 등 상품 요건이 애매한 경우 필수 조건을 점검한다", "차량 명의와 연식 조건부터 확인한 뒤 진행 가능 여부를 안내드리겠습니다."),
    Tactic.SIMPLIFY_PROCESS: ("절차 부담 고객에게 단계와 소요 시간을 짧게 정리한다", "진행은 조건 확인, 심사, 결과 안내 순서로 간단히 진행됩니다."),
    Tactic.EXPLAIN_REPAY: ("상환 방식, 기간, 중도상환 등 이용 후 조건을 설명한다", "상환 기간과 월 납입 방식, 중도상환 가능 여부를 함께 확인하시면 됩니다."),
    Tactic.SUPPORT_COMPARE: ("바로 결정하지 않는 고객에게 비교 기준을 정리해 판단을 돕는다", "금리, 월 납입, 총 상환액 기준으로 비교해보시면 됩니다."),
    Tactic.URGENT_EXEC: ("빠른 자금이 필요한 고객에게 가능 시점과 필수 확인사항을 우선 안내한다", "오늘 진행 가능 여부를 보려면 필수 확인사항부터 먼저 체크하겠습니다."),
    Tactic.SCHEDULE_CALLBACK: ("지금 통화가 어려운 고객을 후속 콜 기회로 전환한다", "편하신 시간에 다시 연락드릴 수 있도록 시간대를 확인하겠습니다."),
    Tactic.RESPECT_REJECTION: ("거절·짜증 고객에게 추가 설득을 멈추고 종료 또는 수신거부 처리를 안내한다", "원치 않으시는 것으로 확인되어 추가 안내는 진행하지 않겠습니다."),
    Tactic.HANDOFF_PROTECT: ("AI 단정 응답이 위험한 경우 안전 문구로 전환하거나 사람에게 넘긴다", "확정적으로 안내드리기 어려운 부분이라 상담원을 통해 정확히 확인드리겠습니다."),
}

# 전략 카드 lead(.slead) — SSOT-3 STRAT20 원문(docs/consult_redesigned-3.html:1677~).
# FRONTEND 카드①(#stratGrid)의 .stx=전략명(=Tactic.value), .slead=아래 한 문장.
# TACTIC_DEF[0](상세 정의)와 의미는 같으나 화면 노출 텍스트는 SSOT-3 원문이 정본이므로 분리 보관.
TACTIC_LEAD: dict[Tactic, str] = {
    Tactic.AROUSE_INTEREST: "개인 관련성 높은 한 문장으로 통화 지속 이유를 만든다",
    Tactic.BUILD_TRUST: "통화 출처·연락 사유·공식 절차를 먼저 설명해 경계를 낮춘다",
    Tactic.CLARIFY_PRODUCT: "상품의 목적과 구조를 먼저 정리한다",
    Tactic.RESOLVE_DOUBT: "과장 없이 확인 전/후 정보를 분리해 설명한다",
    Tactic.EMPATHIZE_PIVOT: "우려를 먼저 인정한 뒤 부담 낮은 다음 행동으로 연결한다",
    Tactic.EASE_ANXIETY: "신용·개인정보·승인 불안에 안전 기준과 절차를 설명한다",
    Tactic.EASE_BURDEN: "월 납입·기간·대환 관점으로 상환 부담을 설명한다",
    Tactic.EXPLORE_LIMIT: "확정 표현 없이 가능 한도 확인 절차로 유도한다",
    Tactic.COMPARE_RATE: "기존 조건 대비 비교 기준을 제시한다",
    Tactic.PROPOSE_REFINANCE: "갈아타기 가능성과 절감 효과를 확인시킨다",
    Tactic.EXTRA_FUND: "필요 금액·사용 시점·상환 가능성을 확인한다",
    Tactic.CHECK_APPROVAL: "고객 조건으로 진행 가능한지 기본 요건을 확인한다",
    Tactic.CHECK_ELIGIBILITY: "명의·연식·소득 등 필수 조건을 점검한다",
    Tactic.SIMPLIFY_PROCESS: "단계와 소요 시간을 짧게 정리한다",
    Tactic.EXPLAIN_REPAY: "상환 방식·기간·중도상환 등 이용 후 조건을 설명한다",
    Tactic.SUPPORT_COMPARE: "금리·월 납입·총 상환액 기준으로 비교를 돕는다",
    Tactic.URGENT_EXEC: "가능 시점과 필수 확인사항을 우선 안내한다",
    Tactic.SCHEDULE_CALLBACK: "후속 콜 기회로 전환한다",
    Tactic.RESPECT_REJECTION: "추가 설득을 멈추고 종료·수신거부를 안내한다",
    Tactic.HANDOFF_PROTECT: "안전 문구로 전환하거나 사람에게 넘긴다",
}


def tactic_lead(tactic: "Tactic | None") -> str:
    """Tactic → 전략 카드 lead(.slead) 문구. None이면 빈 문자열."""
    if tactic is None:
        return ""
    return TACTIC_LEAD.get(tactic, "")


# ─────────────────────────────────────────────────────────────────────────────
# 시연 케이스 (xlsx '시연 케이스' 표) — 데모 시나리오 ↔ 신호 프로파일 매핑
# ─────────────────────────────────────────────────────────────────────────────


class DemoCase(str, Enum):
    """데모 3종 (xlsx 시연 케이스)."""

    REFINANCE_INTEREST = "대환 관심 고객"
    HIGH_COMPLAINT = "고강도 불만 고객"
    FRAUD_DOUBT = "보이스피싱 의심 고객"


# 시연 케이스별 기대 신호 프로파일 (감정/니즈/이용가능성/대표 전략).
# 데모 리허설·회귀 테스트에서 classify 출력이 이 프로파일에 수렴하는지 점검하는 기준.
DEMO_PROFILE: dict[DemoCase, dict] = {
    DemoCase.REFINANCE_INTEREST: {
        "emotion": Emotion.BURDENED,
        "need": Need.LOWER_PAYMENT,
        "usability": Usability.AFTER_COMPARE,
        "tactic": Tactic.PROPOSE_REFINANCE,
    },
    DemoCase.HIGH_COMPLAINT: {
        "emotion": Emotion.ANNOYED,
        "need": Need.OPT_OUT,
        "usability": Usability.LOAN_REFUSED,
        "tactic": Tactic.RESPECT_REJECTION,
    },
    DemoCase.FRAUD_DOUBT: {
        "emotion": Emotion.WARY,
        "need": Need.SAFETY,
        "usability": Usability.NEEDS_TRUST,
        "tactic": Tactic.BUILD_TRUST,
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# 안전 파서 — LLM 문자열 → Enum (카탈로그 밖이면 None, 호출측이 폴백)
# ─────────────────────────────────────────────────────────────────────────────


def to_emotion(value: str | None) -> Emotion | None:
    return _coerce(Emotion, value)


def to_need(value: str | None) -> Need | None:
    return _coerce(Need, value)


def to_usability(value: str | None) -> Usability | None:
    return _coerce(Usability, value)


def to_tactic(value: str | None) -> Tactic | None:
    return _coerce(Tactic, value)


def _coerce(enum_cls, value: str | None):
    """엄격 변환: 한국어 라벨(value) 또는 영문 멤버명(name) 모두 허용. 미상이면 None."""
    if not value:
        return None
    raw = value.strip()
    try:
        return enum_cls(raw)            # 한국어 라벨 매칭
    except ValueError:
        pass
    try:
        return enum_cls[raw.upper()]    # 영문 멤버명 매칭
    except KeyError:
        return None


def labels(enum_cls) -> list[str]:
    """프롬프트 주입용 — Enum의 한국어 라벨 목록."""
    return [m.value for m in enum_cls]
