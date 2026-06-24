"""체험(experience) 시나리오 전용 — intent별 분석 preset 카탈로그.

체험 큐 행(callId가 'exp-'로 시작)에서만 사용한다. classify가 고객 발화의 intent를
잡으면, 이 테이블에서 해당 intent의 preset(감정/니즈/이용가능성 + 대표전략 + 토큰 +
DB분석 + 컴플라이언스 가안)을 꺼내 4카드를 일관되게 채운다.

⚠️ 박서준 데모(스크립트 엔진 경로, callId='c-demo-*')는 이 모듈을 절대 타지 않는다.
   적용 가드는 호출측(nodes.classify/persist, compliance.review_loop)의 is_experience()다.

값 규약:
- emotion/need/usability/tactic: signals.py Enum의 **한국어 라벨**(엄격 파서 통과값).
- tokens: 카드① 발화분석 버블 — {text, polarity(PRO|CONS|NEUTRAL), reason}.
- db_chips: 카드② '사용 데이터' 칩 라벨.
- db_nodes: 카드② 분석결과 도식 노드 — {label, val, tone(pos|warn|neg|None)}.
- compliance_draft: 카드③ 가안(수정 전) 텍스트. 위반 표현은 compliance_violations에.
  (수정 후 final은 preset을 쓰지 않고 실제 LLM redraft 결과를 사용한다.)
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .state import Intent


@dataclass(frozen=True)
class ExpPreset:
    emotion: str
    need: str
    usability: str
    tactic: str
    headline: str
    rationale: str
    tokens: list[dict] = field(default_factory=list)
    db_chips: list[str] = field(default_factory=list)
    db_nodes: list[dict] = field(default_factory=list)
    compliance_draft: str = ""
    compliance_violations: list[str] = field(default_factory=list)


def _tok(text: str, polarity: str, reason: str) -> dict:
    return {"text": text, "polarity": polarity, "reason": reason}


def _node(label: str, val: str, tone: str | None = None) -> dict:
    return {"label": label, "val": val, "tone": tone}


# intent → preset. 값은 signals.py 라벨과 정확히 일치(엄격 파서 통과).
EXP_PRESETS: dict[Intent, ExpPreset] = {
    Intent.IDENTITY_CONFIRMED: ExpPreset(
        emotion="수용", need="본인 확인", usability="조건부 진행",
        tactic="신뢰 확보 전략", headline="본인 확인 완료 — 녹취 고지로 신뢰 형성",
        rationale="본인 확인이 되어 다음 단계로 진행 가능. 녹취 고지로 신뢰를 확보한다.",
        tokens=[_tok("네 맞아요", "PRO", "본인 확인 수용")],
        db_chips=["고객 프로필", "본인 인증"],
        db_nodes=[_node("본인 확인", "완료", "pos"), _node("통화 동의", "녹취 고지", None)],
        compliance_draft="네, 박서준 고객님 본인 맞으시죠? 안내 시작할게요.",
        compliance_violations=[],
    ),
    Intent.IDENTITY_FAILED: ExpPreset(
        emotion="경계", need="본인 확인", usability="신뢰 확보 필요",
        tactic="신뢰 확보 전략", headline="본인 확인 실패 — 재확인 또는 종료",
        rationale="본인 확인이 되지 않아 더 진행할 수 없다. 정중히 재확인하거나 종료한다.",
        tokens=[_tok("제가 아닌데요", "CONS", "본인 불일치")],
        db_chips=["고객 프로필"],
        db_nodes=[_node("본인 확인", "불일치", "neg")],
        compliance_draft="본인이 아니시면 안내가 어렵습니다. 죄송합니다.",
        compliance_violations=[],
    ),
    Intent.RECORDING_REFUSED: ExpPreset(
        emotion="거부감", need="안전성 확인", usability="컴플라이언스 중단 필요",
        tactic="상담원 인계·컴플라이언스 보호 전략", headline="녹취 거부 — 컴플라이언스 보호 중단",
        rationale="녹취 동의를 거부했다. 강요 없이 절차상 안내를 중단하고 보호한다.",
        tokens=[_tok("녹음하지 마세요", "CONS", "녹취 거부")],
        db_chips=["통화 동의"],
        db_nodes=[_node("녹취 동의", "거부", "neg")],
        compliance_draft="녹취를 원치 않으시면 진행이 어렵습니다. 양해 부탁드립니다.",
        compliance_violations=[],
    ),
    Intent.CONSENT_GIVEN: ExpPreset(
        emotion="수용", need="상품 확인", usability="조건부 진행",
        tactic="관심 환기 전략", headline="동의 확보 — 상품 안내 본격 시작",
        rationale="통화·녹취에 동의했다. 상품 핵심 가치로 관심을 환기한다.",
        tokens=[_tok("네 들어볼게요", "PRO", "안내 동의")],
        db_chips=["고객 프로필", "보유 대출"],
        db_nodes=[_node("통화 동의", "완료", "pos"), _node("상품 안내", "진행", None)],
        compliance_draft="동의 감사합니다. 고객님께 맞는 대환 조건을 안내드릴게요.",
        compliance_violations=[],
    ),
    Intent.INTEREST: ExpPreset(
        emotion="관심", need="대환 가능성", usability="조건부 진행",
        tactic="관심 환기 전략", headline="관심 표명 — 절감 효과로 몰입 유도",
        rationale="고객이 조건을 더 들어볼 의향을 보였다. 절감 효과를 구체화해 몰입을 높인다.",
        tokens=[_tok("어떤 조건인데요", "PRO", "관심 표명"), _tok("들어볼게요", "PRO", "진행 의향")],
        db_chips=["고객 프로필", "보유 대출", "대환 한도"],
        db_nodes=[_node("대환 가능", "예상 한도 확인", "pos"), _node("절감 효과", "월납입 비교", None)],
        compliance_draft="좋은 선택이세요. 지금 조건이면 무조건 더 싸게 갈아타실 수 있어요.",
        compliance_violations=["무조건 더 싸게 갈아타실 수 있어요"],
    ),
    Intent.QUESTION_TERMS: ExpPreset(
        emotion="비교", need="금리 비교", usability="금리 확인 후 판단",
        tactic="금리 비교 전략", headline="조건 질문 — 예시 기반 금리 비교 제시",
        rationale="금리·조건을 확인하려 한다. 확정 단정 없이 예시로 비교 안내한다.",
        tokens=[_tok("금리가 몇 퍼센트", "NEUTRAL", "조건 질문"), _tok("지금보다 나아요?", "PRO", "비교 의향")],
        db_chips=["보유 대출", "신용평가", "금리 비교"],
        db_nodes=[_node("타사 금리", "13%대", "warn"), _node("대환 예상", "심사 후 확정", None)],
        compliance_draft="신용대출 12%, 담보대출 10%로 확정해드립니다.",
        compliance_violations=["12%, 담보대출 10%로 확정해드립니다"],
    ),
    Intent.FRAUD_DOUBT: ExpPreset(
        emotion="의심", need="안전성 확인", usability="신뢰 확보 필요",
        tactic="의심 해소 전략", headline="진위 의심 — 출처·근거로 신뢰 회복",
        rationale="보이스피싱을 의심한다. 회사·연락 경위를 투명하게 밝혀 신뢰를 회복한다.",
        tokens=[_tok("이거 진짜 맞아요?", "CONS", "진위 의심"), _tok("어디서 났어요", "CONS", "출처 의심")],
        db_chips=["통화 동의", "마케팅 동의"],
        db_nodes=[_node("연락 근거", "마케팅 동의 이력", "pos"), _node("발신 출처", "현대캐피탈", None)],
        compliance_draft="저희는 고객님이 동의하신 마케팅 정보로 연락드린 정식 안내입니다.",
        compliance_violations=[],
    ),
    Intent.TRANSFER_INTENT: ExpPreset(
        emotion="짜증", need="본인 확인", usability="상담원 연결 필요",
        tactic="상담원 인계·컴플라이언스 보호 전략", headline="상담원 요청 — 즉시 인계",
        rationale="상담원 연결을 요청했다. 단계 무시하고 즉시 인계한다.",
        tokens=[_tok("사람 바꿔주세요", "NEUTRAL", "상담원 연결 요청")],
        db_chips=["고객 프로필"],
        db_nodes=[_node("상담원 인계", "연결 대기", "warn")],
        compliance_draft="네, 바로 상담원에게 연결해 드리겠습니다.",
        compliance_violations=[],
    ),
    Intent.LIMIT_INQUIRY: ExpPreset(
        emotion="기대", need="한도 확인", usability="한도 확인 후 판단",
        tactic="한도 탐색 전략", headline="한도 문의 — 조회 후 상담원 연결",
        rationale="대출 가능 한도를 알고 싶어한다. 한도 조회는 상담원 경로로 연결한다.",
        tokens=[_tok("얼마까지 나와요?", "PRO", "한도 확인 니즈")],
        db_chips=["신용평가", "대환 한도"],
        db_nodes=[_node("예상 한도", "심사 후 확정", None), _node("한도 조회", "상담원 연결", "warn")],
        compliance_draft="한도는 무조건 최대로 나오게 해드릴게요.",
        compliance_violations=["무조건 최대로 나오게 해드릴게요"],
    ),
    Intent.BUYING_INTENT: ExpPreset(
        emotion="수용", need="실행 속도", usability="즉시 진행 가능",
        tactic="절차 간소화 전략", headline="가입 의향 — 셀프 진행 안내",
        rationale="진행 의사를 명확히 했다. 절차를 간소화해 셀프 디지털 실행을 돕는다.",
        tokens=[_tok("그럼 진행할게요", "PRO", "가입 의향"), _tok("어떻게 하면 돼요", "PRO", "실행 문의")],
        db_chips=["대환 한도", "상환 조건"],
        db_nodes=[_node("진행 단계", "서류 안내", "pos"), _node("실행 방법", "모바일 링크", None)],
        compliance_draft="지금 신청만 하시면 바로 됩니다. 서류는 나중에 주셔도 돼요.",
        compliance_violations=["지금 신청만 하시면 바로 됩니다"],
    ),
    Intent.OPT_OUT: ExpPreset(
        emotion="거부감", need="연락 중단/수신거부", usability="컴플라이언스 중단 필요",
        tactic="거절 존중 전략", headline="수신 거부 — 즉시 철회 접수",
        rationale="마케팅 수신 철회를 요청했다. 재설득 없이 즉시 접수하고 종료한다.",
        tokens=[_tok("연락하지 마세요", "CONS", "수신 거부")],
        db_chips=["마케팅 동의"],
        db_nodes=[_node("마케팅 수신", "철회 접수", "neg")],
        compliance_draft="네, 마케팅 수신 철회 정상 접수했습니다. 더는 연락드리지 않겠습니다.",
        compliance_violations=[],
    ),
    Intent.REJECTION: ExpPreset(
        emotion="거부감", need="연락 중단/수신거부", usability="대출 거부",
        tactic="공감 후 전환 전략", headline="대출 거부 — 공감 후 부담 낮은 다음 행동",
        rationale="대출 자체에 부정적이다. 우려를 인정한 뒤 부담 없는 비교만 제안한다.",
        tokens=[_tok("대출 안 해요", "CONS", "대출 거부"), _tok("관심 없어요", "CONS", "거부 의사")],
        db_chips=["보유 대출"],
        db_nodes=[_node("고객 의향", "거부", "neg"), _node("대안", "비교 정보만", None)],
        compliance_draft="대출 안 받으셔도 괜찮아요. 무조건 이득이니 비교만이라도 꼭 하세요.",
        compliance_violations=["무조건 이득이니"],
    ),
    Intent.DEFER: ExpPreset(
        emotion="망설임", need="상환 조건", usability="재통화 가능",
        tactic="재통화 예약 전략", headline="보류 — 재통화 예약으로 연결",
        rationale="지금은 결정을 미룬다. 압박 없이 편한 시간에 재통화를 예약한다.",
        tokens=[_tok("나중에요", "NEUTRAL", "결정 보류"), _tok("생각해볼게요", "NEUTRAL", "망설임")],
        db_chips=["고객 프로필"],
        db_nodes=[_node("진행 상태", "보류", "warn"), _node("후속", "재통화 예약", None)],
        compliance_draft="알겠습니다. 편하실 때 다시 안내드릴까요?",
        compliance_violations=[],
    ),
    Intent.SILENCE: ExpPreset(
        emotion="무관심", need="본인 확인", usability="설명 추가 필요",
        tactic="관심 환기 전략", headline="무응답 — 재확인 후 관심 환기",
        rationale="응답이 없다. 들리는지 한 번 재확인하고 관심을 환기한다.",
        tokens=[],
        db_chips=[],
        db_nodes=[_node("응답", "무응답", "warn")],
        compliance_draft="고객님, 잘 들리시나요? 들리시면 말씀해 주세요.",
        compliance_violations=[],
    ),
    Intent.UNCLEAR: ExpPreset(
        emotion="망설임", need="상품 확인", usability="설명 추가 필요",
        tactic="공감 후 전환 전략", headline="의도 불명확 — 핵심 재안내로 명확화",
        rationale="발화 의도가 모호하다. 핵심을 다시 짚어 다음 행동을 명확히 한다.",
        tokens=[_tok("음 글쎄요", "NEUTRAL", "의도 불명확")],
        db_chips=["고객 프로필", "보유 대출"],
        db_nodes=[_node("분석", "추가 발화 대기", None)],
        compliance_draft="혹시 어떤 점이 궁금하신지 편하게 말씀해 주세요.",
        compliance_violations=[],
    ),
}


def preset_for(intent: Intent | None) -> ExpPreset | None:
    """intent → preset. 매핑 없으면(또는 None) UNCLEAR로 폴백."""
    if intent is None:
        return EXP_PRESETS.get(Intent.UNCLEAR)
    return EXP_PRESETS.get(intent, EXP_PRESETS.get(Intent.UNCLEAR))
