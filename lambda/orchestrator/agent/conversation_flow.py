"""대출 상담 진행 단계 State (ConvFlow) 재구성 + 라우팅 규칙.

AGENT 모듈. 설계 의도(요청):
  1~4 단계를 순차 진행하고, 거절(종료 시도) 횟수로 방어/종료를 가른다.
    1. 본인 확인 응답을 받았는지        (identity_confirmed)
    2. 통화 가능한지 묻고 답을 들었는지  (availability_confirmed)
    3. 대출 상담 오퍼를 했는지          (offer_made)
    4. 대출할 건지 답을 들었는지        (loan_interest_answered)
    5. 대출 진행할지 말지              (loan_decision: proceed|decline)
    6. 통화 거부 횟수                  (rejection_count)

규칙:
  - 1~4는 순차: 앞 단계가 Y가 되어야 다음 단계가 Y로 넘어간다.
  - rejection_count 0→1: 종료 방어 1회(설득 후 계속).
  - rejection_count ≥2: 즉시 통화 종료.
  - 1~4 전부 Y: 상담 목표 달성 → 통화 종료, 5(loan_decision)대로 마무리 멘트.

Lambda는 stateless이므로 매 턴 history + 이번 고객 발화로 flow를 재구성한다.
"""

from __future__ import annotations

from .state import CallState, ConvFlow

# ── 키워드 사전 (룰 기반 판정) ────────────────────────────────────────────────
# 긍정/수락 — 본인확인 "네 맞아요", 통화가능 "네 괜찮아요" 등.
_AFFIRM_KW = (
    "네", "예", "맞아요", "맞습니다", "맞는데", "그렇", "응", "어요", "좋아요",
    "괜찮", "가능", "해주세요", "알겠", "그래요", "좋습니다", "할게요", "할래요",
)
# 부정/거부 — 통화 종료 시도/거절.
_REJECT_KW = (
    "끊을게요", "끊을래요", "끊어", "관심없", "관심 없", "필요없", "필요 없",
    "됐어요", "됐습니다", "꺼지", "안 받", "안받", "바빠", "바쁘", "나중에",
    "싫어", "싫습니다", "하지마", "하지 마", "연락하지", "그만",
)
# 대출 진행 의향(긍정) — 4단계 답에서 "진행/할게요/알아볼게요/좋아요".
_PROCEED_KW = (
    "진행", "할게요", "할래요", "해볼게요", "해볼래요", "알아볼", "신청",
    "받을게요", "받고 싶", "좋아요", "좋습니다", "해주세요", "가입",
)
# 대출 거절(진행 안 함) — 4단계 답에서 "안 할래요/필요 없어요".
_DECLINE_KW = (
    "안 할", "안할", "안 받", "안받", "필요없", "필요 없", "관심없", "관심 없",
    "됐어요", "안 해", "안해", "생각 없", "생각없",
)
# 봇이 대출 상담 오퍼를 했는지 판정하는 표지(봇 발화에 등장).
_OFFER_MARK = ("대출", "금리", "상품", "비교", "대환", "한도")


def _has(text: str, kws: tuple[str, ...]) -> bool:
    return any(k in text for k in kws)


def _is_reject(text: str) -> bool:
    return _has(text, _REJECT_KW)


def _is_affirm(text: str) -> bool:
    # 거부 신호가 섞여 있으면 긍정으로 보지 않는다(거부 우선).
    return _has(text, _AFFIRM_KW) and not _is_reject(text)


def reconstruct(state: CallState) -> ConvFlow:
    """history + 이번 고객 발화(customer_text)로 ConvFlow를 재구성한다.

    턴을 시간 순으로 훑으며 규칙으로 1~4 플래그를 순차 채우고, 거절 횟수를 센다.
    이번 턴 고객 발화는 history 마지막 customer Turn으로 이미 들어와 있을 수도, 아닐 수도
    있어(경로마다 다름) 중복 카운트를 피하려 customer_text가 history 마지막 고객 발화와
    같으면 history만으로 처리한다.
    """
    flow: ConvFlow = {
        "identity_confirmed": False,
        "availability_confirmed": False,
        "offer_made": False,
        "loan_interest_answered": False,
        "loan_decision": "",
        "rejection_count": 0,
    }

    history = state.get("history") or []

    # 처리할 발화 시퀀스: history 전체 + (history에 아직 안 들어온) 이번 고객 발화.
    turns: list[tuple[str, str]] = [
        (m.get("speaker", ""), m.get("text") or "") for m in history
    ]
    cur = (state.get("customer_text") or "").strip()
    last_cust = next(
        (t for s, t in reversed(turns) if s == "customer"), None
    )
    if cur and cur != last_cust:
        turns.append(("customer", cur))

    for speaker, text in turns:
        if speaker == "bot":
            # 본인확인+통화가능이 끝난 뒤 봇이 다시 말하면 그 발화가 '대출 상담 오퍼'.
            if (
                flow["identity_confirmed"]
                and flow["availability_confirmed"]
                and not flow["offer_made"]
                and _has(text, _OFFER_MARK)
            ):
                flow["offer_made"] = True
            continue

        if speaker != "customer":
            continue

        # 고객 발화 — 거부 신호면 거절 카운트(단계 진행은 하지 않음).
        if _is_reject(text):
            flow["rejection_count"] += 1
            continue

        # 순차 진행: 앞 단계가 Y여야 다음 단계로.
        if not flow["identity_confirmed"]:
            if _is_affirm(text):
                flow["identity_confirmed"] = True
        elif not flow["availability_confirmed"]:
            if _is_affirm(text):
                flow["availability_confirmed"] = True
        elif flow["offer_made"] and not flow["loan_interest_answered"]:
            # 4단계: 대출 의향 답변 — 진행/거절 분기(5단계 결정).
            flow["loan_interest_answered"] = True
            if _has(text, _DECLINE_KW):
                flow["loan_decision"] = "decline"
            elif _has(text, _PROCEED_KW) or _is_affirm(text):
                flow["loan_decision"] = "proceed"
            else:
                flow["loan_decision"] = "proceed"  # 모호하면 진행 의향으로 본다

    return flow


def all_steps_done(flow: ConvFlow) -> bool:
    """1~4단계가 전부 Y인지 — 상담 목표 달성(통화 종료 조건)."""
    return bool(
        flow.get("identity_confirmed")
        and flow.get("availability_confirmed")
        and flow.get("offer_made")
        and flow.get("loan_interest_answered")
    )


def should_close(flow: ConvFlow) -> bool:
    """이번 턴에 통화를 종료해야 하는지.

    - 거절 2회 이상: 즉시 종료.
    - 1~4 전부 Y: 상담 완료 → 종료(5단계 결정대로 마무리).
    """
    return flow.get("rejection_count", 0) >= 2 or all_steps_done(flow)


def is_first_rejection_defense(flow: ConvFlow) -> bool:
    """거절 0→1 전이(첫 거절) — 종료가 아니라 방어(설득 1회)할 상황."""
    return flow.get("rejection_count", 0) == 1 and not all_steps_done(flow)
