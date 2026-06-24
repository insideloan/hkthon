"""LangGraph 노드 함수 / Node implementations.

AGENT 모듈. 설계: docs/agent/LANGGRAPH-DESIGN.md §4.

각 노드는 CallState를 받아 부분 업데이트(dict)를 반환한다(LangGraph 머지 규약).
하이브리드 턴 처리: fast_route(룰) → 필요 시 classify(LLM 1-call) → churn → respond → compliance.

⚠️ 스켈레톤: 시그니처/라우팅/흐름은 확정. LLM·DynamoDB 호출 본문은 TODO.
"""

from __future__ import annotations

import os

from . import churn_risk, compliance as compliance_mod, mot as mot_mod, prompts, signals
from ..llm import router
from .state import (
    CallState,
    CallStatus,
    Intent,
    Route,
    Stage,
    Strategy,
)

# ─────────────────────────────────────────────────────────────────────────────
# 0. 룰 사전 (fast_route용) — LANGGRAPH-DESIGN §4.3
#    공통요건 "거절 최우선"·"상담원 우선이관"을 LLM 없이 보장한다.
# ─────────────────────────────────────────────────────────────────────────────

_REJECTION_KW = ("끊을게요", "끊을래요", "관심없", "관심 없", "필요없", "필요 없", "됐어요", "꺼지")
_TRANSFER_KW = ("상담원", "사람 바꿔", "사람바꿔", "사람으로", "직원", "ai랑", "ai 랑", "사람이랑")
_LIMIT_KW = ("한도조회", "한도 조회", "한도가 얼마", "조회해")
_OPT_OUT_KW = ("연락하지마", "연락하지 마", "동의 취소", "동의취소", "철회")
_MIN_RESPONSE = ("", "네", "음", "어", "예", "네…", "음…", "...")
# 첫인사/통화 응답("여보세요" 등) — 고객이 전화를 받아 응답했다는 신호.
# 봇이 발신자이므로 이건 침묵도 거절도 아닌 정상 진행 신호 → classify(LLM) 없이 RESPOND.
# (이게 없으면 classify로 위임돼 간헐적 오분류·지연·NAME 가드레일 redraft 루프를 유발했다.)
_GREETING_KW = ("여보세요", "여보 세요", "네 여보세요", "누구세요", "누구시", "어 네", "예 여보세요")

# 금융사기/보이스피싱 의심 신호 (xlsx '안전성 확인' 니즈 + STEP2 보이스피싱 케이스).
# 감지되면 fraud_suspected 플래그만 세팅 — 라우팅·종료에 영향 없음(대시보드 표시 전용).
_FRAUD_KW = (
    "보이스피싱", "보이스 피싱", "피싱", "사기", "사기 전화", "사기전화",
    "진짜 현대캐피탈", "진짜 맞", "사칭", "이거 진짜", "어디서 났",
    "개인정보 어떻게", "번호 어떻게 아", "신고할", "경찰",
)


# ─────────────────────────────────────────────────────────────────────────────
# 1. load_context — DynamoDB에서 CallState 재구성 (LLM 없음)
# ─────────────────────────────────────────────────────────────────────────────


def load_context(state: CallState) -> CallState:
    """DynamoDB Turn 이력 → CallState 재구성. 실제 로딩은 context.load_call_state()에 위임.

    call_id가 있고 history가 아직 안 채워졌으면 DynamoDB에서 재구성한다(라이브 진입점).
    이미 채워진 상태(테스트/사전 주입)는 그대로 두고 방어적 기본값만 보정한다.
    """
    from . import context

    if state.get("call_id") and "history" not in state:
        loaded = context.load_call_state(state["call_id"], state.get("customer_text", ""))
        loaded.update({k: v for k, v in state.items() if k not in loaded})
        state = loaded

    state.setdefault("history", [])
    state.setdefault("churn_before", 50)
    state.setdefault("stage", Stage.IDENTIFY)
    state.setdefault("next_seq", 1)
    state.setdefault("call_status", CallStatus.ACTIVE)
    return state


# ─────────────────────────────────────────────────────────────────────────────
# 2. fast_route — 룰 기반 조기 분기 (하이브리드 1단계, LLM 없음)
# ─────────────────────────────────────────────────────────────────────────────


def fast_route(state: CallState) -> CallState:
    """명확한 케이스를 LLM 없이 즉시 라우팅. 애매하면 Route.NEEDS_LLM."""
    text = (state.get("customer_text") or "").strip()
    low = text.lower()

    # 공통요건: 거절 최우선
    if any(k in text for k in _REJECTION_KW):
        intent, route = Intent.REJECTION, Route.CLOSE
    # 공통요건: 상담원 연결 우선 처리 (단계 무시 즉시 이관)
    elif any(k in low for k in _TRANSFER_KW):
        intent, route = Intent.TRANSFER_INTENT, Route.TRANSFER
    elif any(k in text for k in _LIMIT_KW):
        intent, route = Intent.LIMIT_INQUIRY, Route.TRANSFER
    elif any(k in text for k in _OPT_OUT_KW):
        intent, route = Intent.OPT_OUT, Route.CLOSE
    elif text in _MIN_RESPONSE:
        intent, route = Intent.SILENCE, Route.SILENCE
    # 첫인사/통화 응답("여보세요") → 정상 진행(RESPOND). 거절·이관·한도·옵트아웃을 먼저
    # 거른 뒤이므로 "여보세요 상담원 바꿔주세요" 같은 복합 발화는 위에서 TRANSFER로 처리됨.
    elif any(k in text for k in _GREETING_KW):
        intent, route = Intent.IDENTITY_CONFIRMED, Route.RESPOND
    else:
        # 질문·반론·애매 → LLM classify로 위임
        intent, route = Intent.UNCLEAR, Route.NEEDS_LLM

    return {"intent": intent, "route": route, "classified_by": "rule"}


def fast_route_branch(state: CallState) -> str:
    """fast_route 이후 조건부 엣지 (LANGGRAPH-DESIGN §5)."""
    route = state.get("route")
    if route == Route.NEEDS_LLM:
        return "classify"
    if route == Route.SILENCE:
        return "silence"
    return "churn_score"  # 룰로 확정된 transfer/close/respond


# ─────────────────────────────────────────────────────────────────────────────
# 3. classify — LLM 1-call (하이브리드 2단계, 조건부)
# ─────────────────────────────────────────────────────────────────────────────


# speculative 병렬 모드: classify와 blind respond(전략 미주입)를 동시 실행해 직렬 지연 단축.
# 기본 OFF — blind draft는 tactic/emotion 스티어링을 잃으므로(품질 trade-off) opt-in.
# 켜면 RESPOND 경로에서 respond 지연(~1.6-2.3s)을 classify 뒤로 숨긴다.
_SPECULATIVE_RESPOND = os.environ.get("SPECULATIVE_RESPOND", "0") == "1"


def classify(state: CallState) -> CallState:
    """단일 Bedrock Converse(structured output)로 intent/route/emotion/fraud/
    churn_adjust/strategy/rationale를 한 번에 추출. stage별 xlsx 가이드를 프롬프트에 주입.

    SPECULATIVE_RESPOND=1이면 classify와 동시에 blind respond(전략 미주입)를 병렬 실행하고
    그 draft를 _blind_draft로 실어둔다 — route가 RESPOND면 respond 노드가 재사용(직렬 1콜 절감).
    """
    system = prompts.classify_system(state.get("stage", Stage.IDENTIFY), state.get("customer"))
    history = _render_history(state)

    blind_draft = None
    if _SPECULATIVE_RESPOND:
        # blind respond: tactic/emotion 없이 stage 가이드만으로 생성(_strategy_block 빈 블록).
        blind_system = prompts.respond_system(
            state.get("stage", Stage.IDENTIFY), state.get("customer"), tactic=None, emotion=None,
        )
        result, blind_draft = router.classify_and_respond_concurrent(system, blind_system, history)
    else:
        result = router.classify_turn(system, history)

    # LLM 장애 → 보수적 기본값(통화 흐름 유지). 거절/이관은 fast_route가 이미 걸렀음.
    if result is None:
        return {
            "intent": Intent.UNCLEAR,
            "route": Route.RESPOND,
            "classified_by": "llm",
            "_churn_adjust": 0,
            "_blind_draft": blind_draft,
        }

    # 신호 4축은 엄격 파싱: 카탈로그 밖 값이면 None으로 폴백(데모 일관성·관리자 화면 안정).
    return {
        "intent": _to_intent(result.intent),
        "route": _to_route(result.route),
        "emotion": signals.to_emotion(result.emotion),
        "need": signals.to_need(result.need),
        "usability": signals.to_usability(result.usability),
        "fraud_suspected": result.fraud_suspected,
        "strategy": _build_strategy(result.strategy_tactic, result.strategy_headline),
        "rationale": result.rationale,
        "classified_by": "llm",
        # churn_adjust는 churn_score 노드가 ±10 한도로만 반영 (사전 점수 우선)
        "_churn_adjust": result.churn_adjust,
        "_blind_draft": blind_draft,
    }


def route_intent(state: CallState) -> str:
    """classify/churn 이후 최종 라우팅 (LANGGRAPH-DESIGN §5)."""
    route = state.get("route")
    if route == Route.TRANSFER:
        return "transfer_node"
    if route == Route.CLOSE:
        return "close_node"
    if route == Route.SILENCE:
        return "silence"
    return "respond"


# ─────────────────────────────────────────────────────────────────────────────
# 3.5 detect_fraud — 금융사기 의심 플래그 (경유 노드, 분기·종료 없음) AGENT-006
# ─────────────────────────────────────────────────────────────────────────────


def detect_fraud(state: CallState) -> CallState:
    """보이스피싱/사기 의심을 감지해 fraud_suspected 플래그만 세팅.

    중요(공통요건): 이 플래그는 라우팅 분기나 통화 종료를 유발하지 않는다.
    대시보드 표시 전용이며, 통화는 정상 흐름(churn_score → respond)을 계속한다.
    룰(키워드) OR classify의 LLM 판정 중 하나라도 true면 true. 한 번 true면 유지(latching).
    """
    text = state.get("customer_text") or ""
    rule_hit = any(k in text for k in _FRAUD_KW)
    llm_hit = bool(state.get("fraud_suspected"))  # classify가 이미 세팅했을 수 있음
    return {"fraud_suspected": rule_hit or llm_hit}


# ─────────────────────────────────────────────────────────────────────────────
# 4. churn_score — 사전 점수 우선 + LLM ±10 보정 (LANGGRAPH-DESIGN §4.5)
# ─────────────────────────────────────────────────────────────────────────────


def churn_score(state: CallState) -> CallState:
    """이탈위험도 계산. 사전 점수가 1차 진실, classify의 _churn_adjust는 ±10 보정."""
    churn_after, tokens = churn_risk.score(
        state.get("customer_text", ""),
        state.get("churn_before", 50),
        adjust=state.get("_churn_adjust", 0),
        silence_streak=_count_trailing_silence(state) if state.get("intent") == Intent.SILENCE else 0,
    )
    return {"churn_after": churn_after, "churn_tokens": tokens}


# ─────────────────────────────────────────────────────────────────────────────
# 5. respond — 봇 응답 draft 생성 (LLM gen)
# ─────────────────────────────────────────────────────────────────────────────


def respond(state: CallState) -> CallState:
    """Bedrock Converse로 응답 생성. 시스템 프롬프트 = stage 대응전략 + 공통요건 가드.

    공통요건 강제: 확정멘트 금지(수치→예시/가정+심사), 중요사항 누락금지, 선택권 존중, 재설득 금지.
    """
    # speculative 모드: classify와 병렬로 만든 blind draft가 있으면 재사용(직렬 1콜 절감).
    # FALLBACK_TEXT(생성 실패)면 신뢰 못 하므로 아래 정식 경로로 재생성한다.
    blind_draft = state.get("_blind_draft")
    if blind_draft and blind_draft != router.FALLBACK_TEXT:
        return {"bot_draft": blind_draft}

    system = prompts.respond_system(
        state.get("stage", Stage.IDENTIFY),
        state.get("customer"),
        tactic=signals.to_tactic((state.get("strategy") or {}).get("tactic")),
        emotion=state.get("emotion"),
    )
    draft = router.converse(system, _render_history(state), stream=False)
    return {"bot_draft": draft}


# ─────────────────────────────────────────────────────────────────────────────
# 6. compliance — Guardrails 루프 (LANGGRAPH-DESIGN §4.7, ARCHITECTURE §3.3)
# ─────────────────────────────────────────────────────────────────────────────


def compliance(state: CallState) -> CallState:
    """draft → Guardrails.apply → (blocked면 redraft, try<2) → approved.

    실제 루프는 compliance.review_loop()에 위임. 각 전이는 compliance_log에 적재.
    """
    log, final = compliance_mod.review_loop(state.get("bot_draft", ""), state)
    return {"compliance_log": log, "bot_text": final}


# ─────────────────────────────────────────────────────────────────────────────
# 7. detect_mot (LANGGRAPH-DESIGN §4.8)
# ─────────────────────────────────────────────────────────────────────────────


def detect_mot(state: CallState) -> CallState:
    """RISK/CONVERSION MOT 판정. 실제 규칙은 mot.detect()에 위임."""
    return {"mot": mot_mod.detect(state)}


# ─────────────────────────────────────────────────────────────────────────────
# 8. 종단 노드 — transfer / close / silence (LANGGRAPH-DESIGN §4.9)
# ─────────────────────────────────────────────────────────────────────────────


def transfer_node(state: CallState) -> CallState:
    """상담원 이관. transferToAgent 경로 → call_status=TRANSFER_PENDING (성공경로). 이관 멘트 준비.

    Acceptance(AGENT-006): transfer 시 call_status가 TRANSFER_PENDING으로 전이.

    이관 시 지금까지의 대화를 1~2문장 핸드오프 요약(handoff_summary)으로 만들어
    상담원이 맥락을 즉시 파악하게 한다(persist가 Call META에 기록 → CRM 표시).
    고객에겐 추가 질문으로 시간을 끌지 않는다(요약은 백그라운드 산출물).
    """
    return {
        "route": Route.TRANSFER,
        "call_status": CallStatus.TRANSFER_PENDING,
        "bot_text": "네, 바로 상담원에게 연결해 드리겠습니다. 잠시만 기다려 주세요.",
        "handoff_summary": _build_handoff_summary(state),
        "strategy": {
            "tactic": "즉시 이관",
            "headline": "상담원 연결 요청 — 단계 무시 즉시 이관",
            "lead": signals.tactic_lead(signals.Tactic.HANDOFF_PROTECT),
        },
    }


def _build_handoff_summary(state: CallState) -> str:
    """상담원 이관용 핸드오프 요약. 룰 기반(결정적) 한 줄을 즉시 반환.

    핸드오프 요약은 실시간 통화 흐름이 아니라 상담원 CRM 탭에 표시되는 사후 정보다.
    과거엔 이관마다 LLM(converse)을 동기 호출(~2-5s)했지만, 이관은 고객을 기다리게 하는
    구간이라 라이브 지연에 직접 영향을 준다 — 이미 state에 쌓인 단계/의도/이탈위험/직전
    발화로 충분히 맥락이 전달되므로 LLM 없이 폴백 요약을 쓴다. 더 풍부한 요약이 필요하면
    통화 종료 후 비동기로 보강하는 것이 맞다(임계 경로 분리).
    """
    return _fallback_handoff_summary(state)


def _fallback_handoff_summary(state: CallState) -> str:
    """LLM 없이 state 신호로 구성하는 결정적 핸드오프 요약."""
    parts = []
    stage = _enum_value(state.get("stage"))
    if stage:
        parts.append(f"단계 {stage}")
    intent = _enum_value(state.get("intent"))
    if intent:
        parts.append(f"의도 {intent}")
    churn = state.get("churn_after", state.get("churn_before"))
    if churn is not None:
        parts.append(f"이탈위험 {churn}")
    last = (state.get("customer_text") or "").strip()
    head = "상담원 연결 요청"
    detail = f" — {', '.join(parts)}" if parts else ""
    tail = f' 직전 발화: "{last}"' if last else ""
    return f"{head}{detail}.{tail}".strip()


def close_node(state: CallState) -> CallState:
    """거절/철회/보류 → 정중히 마무리. 즉시 수용, 재설득 금지. call_status=ENDED."""
    intent = state.get("intent")
    if intent == Intent.OPT_OUT:
        text = "네, 마케팅 수신 철회 요청 정상 접수했습니다. 더 이상 연락드리지 않겠습니다. 감사합니다."
    else:
        text = "네, 알겠습니다. 바쁘신데 시간 내주셔서 감사합니다. 필요하시면 언제든 연락 주세요."
    return {"bot_text": text, "stage": Stage.CLOSING, "call_status": CallStatus.ENDED}


def silence(state: CallState) -> CallState:
    """무응답/침묵: 10초 재확인 1회. 연속 무응답 2회↑면 종료(ENDED), 3회 재시도 금지."""
    silence_streak = _count_trailing_silence(state)
    if silence_streak >= 2:
        return {
            "bot_text": "연결 상태가 좋지 않은 것 같습니다. 다음에 다시 연락드리겠습니다.",
            "stage": Stage.CLOSING,
            "call_status": CallStatus.ENDED,
        }
    return {"bot_text": "고객님, 잘 들리시나요? 들리시면 말씀해 주세요."}


# ─────────────────────────────────────────────────────────────────────────────
# 9. persist — DynamoDB write → Streams 팬아웃 (LANGGRAPH-DESIGN §4.9)
# ─────────────────────────────────────────────────────────────────────────────


def persist(state: CallState) -> CallState:
    """Turn/MOT/ComplianceReview/Call write → DynamoDB Streams 팬아웃(_emit*).

    한 nextTurn = 봇 Turn 1건. write 순서는 화면 연출 순서를 따른다:
    Compliance(검수 로그) → Turn(봇 발화 + 분석) → MOT → Call META(상태/전략/사기).
    write 실패가 통화를 끊지 않도록 각 write는 best-effort(예외는 로깅 후 계속).
    """
    from ..api import dynamo
    from ..models.compliance import ComplianceReview
    from ..models.turn import Turn

    call_id = state.get("call_id")
    if not call_id:
        return state

    seq = int(state.get("next_seq", 1))
    ts = _now_iso()

    # 1) ComplianceReview — 검수 루프 단계별 로그(턴당 try 인덱스). 화면 카드③ 소스.
    _persist_compliance(call_id, seq, state.get("compliance_log") or [], ts, ComplianceReview, dynamo)

    # 2) 봇 Turn — bot_text + 이번 턴 분석(churn_after/tokens/flag). onTurn/onIndexUpdate 발화.
    bot_text = state.get("bot_text") or state.get("bot_draft") or ""
    turn = Turn(
        call_id=call_id,
        seq=seq,
        speaker="bot",
        text=bot_text,
        node=_stage_value(state.get("stage")),
        ts=ts,
        tokens=list(state.get("churn_tokens") or []),
        churn_after=state.get("churn_after"),
        flag=_turn_flag(state),
    )
    item = turn.to_item()
    # 분석 스냅샷(emotion)을 Turn 아이템에도 실어 stream_fanout이 onIndexUpdate를 발화하게 한다.
    emotion = _enum_value(state.get("emotion"))
    if emotion is not None:
        item["emotion"] = emotion
    # 봇 Turn을 audio_url 없이 먼저 write → stream_fanout이 _emitTurn(텍스트)를 즉시 팬아웃.
    # TTS 합성(~2-8s)은 텍스트 표시의 임계 경로에서 제외하고(아래 5단계) 끝나면 MODIFY로
    # audio_url을 덧붙여 두 번째 _emitTurn(audioUrl)이 나가게 한다(_dispatch_record는
    # TURN# INSERT/MODIFY 모두에서 _emitTurn 발화). 결과: 텍스트·분석카드가 음성보다 먼저 뜬다.
    _safe_write(dynamo, item, "Turn")

    # 3) MOT — RISK/CONVERSION 판정이 있으면 기록. onMotDetected 발화.
    mot = state.get("mot")
    if mot:
        _persist_mot(call_id, seq, mot, ts, dynamo)

    # 4) Call META — 분석 스냅샷(전략/근거/이탈위험/감정) + 상태 전이 + 사기 플래그.
    _persist_call_meta(call_id, state, emotion, ts, dynamo)

    # 5) 봇 발화 TTS(임계 경로 밖): bot_text → Typecast mp3 → S3 → presigned URL.
    #    텍스트/분석은 위에서 이미 팬아웃됐으므로, 여기서 합성이 느려도 화면 텍스트는 안 막힌다.
    #    완료 시 Turn 아이템을 update → MODIFY Streams → _emitTurn(audioUrl)로 음성만 뒤따라 붙는다.
    audio_url = _synthesize_bot_audio(bot_text, call_id, seq)
    if audio_url:
        state["audio_url"] = audio_url  # nextTurn 동기 응답(runner)에서 노출
        _safe_update(dynamo, dynamo.pk_call(call_id), dynamo.sk_turn(seq),
                     {"audio_url": audio_url}, "Turn.audio_url")

    return state


# ─────────────────────────────────────────────────────────────────────────────
# 보조 함수
# ─────────────────────────────────────────────────────────────────────────────


def _synthesize_bot_audio(text: str, call_id: str, seq: int) -> str | None:
    """봇 발화 텍스트 → Typecast TTS mp3 → S3 업로드 → presigned URL. 실패/미설정 시 None.

    best-effort: TTS는 데모 부가 기능이므로 어떤 실패(API 키 없음, 네트워크, S3)도
    삼키고 None을 돌려 텍스트 파이프라인을 막지 않는다(라이브 응답 지연/장애 격리).
    빈 텍스트/LLM fallback 문구는 합성 생략(불필요한 비용·지연 방지).
    """
    import logging
    import os

    if not text or not text.strip():
        return None
    # 자격증명 미설정이면 합성 자체를 시도하지 않는다(로컬/스크립트/CI 무비용 경로).
    # 배포 환경은 키를 env로 직접 넣지 않고 TYPECAST_SECRET_ARN만 주입하므로
    # (시크릿을 코드/로그에 안 남김), 둘 중 하나라도 있으면 시도한다 —
    # 실제 키 해석은 typecast_tts._resolve_api_key()가 ARN→Secrets Manager 폴백으로 처리.
    if not (os.environ.get("TYPECAST_API_KEY") or os.environ.get("TYPECAST_SECRET_ARN")):
        return None

    try:
        from ..tts import typecast_tts

        voice = os.environ.get("TTS_VOICE_NAME", "혜라")
        key = f"tts/{call_id}/{seq:04d}.mp3"
        _bytes, url = typecast_tts.synthesize(text, voice, s3_key=key)
        return url
    except Exception:  # noqa: BLE001 — TTS 실패가 통화/텍스트 파이프라인을 막지 않게
        logging.getLogger(__name__).exception("TTS synthesize failed (call=%s seq=%s)", call_id, seq)
        return None


def _now_iso() -> str:
    """ISO-8601 UTC 타임스탬프 (resolvers/_common.now_iso와 동일 포맷)."""
    import time

    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _safe_write(dynamo, item: dict, what: str) -> None:
    """best-effort put_item — write 실패가 통화를 끊지 않게 예외를 삼킨다."""
    import logging

    try:
        dynamo.put_item(item)
    except Exception:  # noqa: BLE001 — 데모 안정성
        logging.getLogger(__name__).exception("persist %s write failed", what)


def _safe_update(dynamo, pk: str, sk: str, fields: dict, what: str) -> None:
    """best-effort update_fields — TTS audio_url 등 사후 보강 write가 통화를 끊지 않게."""
    import logging

    try:
        dynamo.update_fields(pk, sk, fields)
    except Exception:  # noqa: BLE001 — 데모 안정성
        logging.getLogger(__name__).exception("persist %s update failed", what)


def _stage_value(stage) -> str | None:
    """Stage enum → 저장용 문자열(node 필드). context._infer_stage가 역추론에 사용."""
    return _enum_value(stage)


def _enum_value(v):
    """Enum이면 .value, 아니면 원값(None 포함) 그대로."""
    return v.value if hasattr(v, "value") else v


def _turn_flag(state: CallState) -> str | None:
    """봇 Turn의 턴 레벨 flag("risk"|"def"|None) — SpeechAnalysis 배지 분기용.

    이번 턴 MOT가 위험(전환 아님)이면 "risk", 전환이면 "def"(전환=방어 성공 신호).
    MOT가 없으면 None(NEUTRAL).
    """
    mot = state.get("mot")
    if not mot:
        return None
    return "def" if mot.get("is_conversion") else "risk"


def _persist_compliance(call_id, turn_seq, log, ts, ComplianceReview, dynamo) -> None:
    """compliance_log 단계들을 ComplianceReview 아이템으로 적재(try_index = 단계 순번)."""
    for try_index, step in enumerate(log):
        review = ComplianceReview(
            call_id=call_id,
            turn=turn_seq,
            try_index=try_index,
            state=step.get("state", "drafting"),
            draft=step.get("draft", ""),
            violated_policies=list(step.get("violated_policies") or []),
            final=step.get("final_text") or "",
            ts=ts,
        )
        _safe_write(dynamo, review.to_item(), "ComplianceReview")


def _persist_mot(call_id, turn_seq, mot, ts, dynamo) -> None:
    """MotResult(wire 값) → MOT 아이템 write (mots.mot_out / stream_fanout 계약 형상).

    detect_mot은 이미 wire 값(motId=MOT_n, state=SHOW.., stageIndex)을 담으므로,
    stageIndex→stage(wire enum)만 매핑해 그대로 직렬화한다(도메인 역매핑 불필요).
    """
    item = {
        "PK": dynamo.pk_call(call_id),
        "SK": dynamo.sk_mot(turn_seq),
        "markerId": mot.get("motId"),
        "state": mot.get("state"),
        "stageIndex": mot.get("stageIndex"),
        "turn_seq": mot.get("turn_seq", turn_seq),
        "ts": ts,
    }
    # stageIndex→stage(wire) 매핑은 mots.mot_out과 동일 규약. Streams 팬아웃이 그대로 읽는다.
    from ..resolvers.mots import _STAGE_BY_INDEX

    idx = item.pop("stageIndex", None)
    if idx is not None and 0 <= int(idx) < len(_STAGE_BY_INDEX):
        item["stage"] = _STAGE_BY_INDEX[int(idx)]
    _safe_write(dynamo, item, "MOT")


def _persist_call_meta(call_id, state, emotion, ts, dynamo) -> None:
    """Call META에 분석 스냅샷 + 상태 전이 + 사기 플래그를 누적 업데이트.

    META MODIFY는 stream_fanout이 _emitStrategyUpdate/_emitQueueUpdate/_emitCallEnded로
    팬아웃한다. update_fields(SET)로 부분 갱신 — 없는 키만 덮어쓴다.
    """
    fields: dict = {"current_node": _stage_value(state.get("stage")), "updated_at": ts}

    if state.get("churn_after") is not None:
        fields["churn_risk"] = state["churn_after"]
    if emotion is not None:
        fields["emotion"] = emotion
    strategy = state.get("strategy") or {}
    if strategy.get("headline"):
        fields["strategy_headline"] = strategy["headline"]
    if state.get("rationale"):
        fields["rationale"] = state["rationale"]
    # fraud_suspected는 한 번 true면 유지(latching) — true일 때만 set, 종료/전이 없음.
    if state.get("fraud_suspected"):
        fields["fraud_suspected"] = True

    # 상태 전이: TRANSFER_PENDING / ENDED (call_status). ACTIVE면 state 미변경.
    status = _enum_value(state.get("call_status"))
    if status == "TRANSFER_PENDING":
        fields["state"] = "TRANSFER_PENDING"
        fields["agent_joined_at"] = ts
        # 상담원 핸드오프 요약 — CRM/상담원이 맥락 즉시 파악(handoff_reason 키로 통일,
        # summaries.write_summary 및 CallSummaryResult.handoffReason과 동일 소스).
        if state.get("handoff_summary"):
            fields["handoff_reason"] = state["handoff_summary"]
    elif status == "ENDED":
        fields["state"] = "ENDED"
        fields["ended_at"] = ts

    try:
        dynamo.update_fields(dynamo.pk_call(call_id), dynamo.SK_META, fields)
    except Exception:  # noqa: BLE001
        import logging

        logging.getLogger(__name__).exception("persist Call META update failed")


def _count_trailing_silence(state: CallState) -> int:
    """history 끝에서 연속된 무응답(고객) 턴 수."""
    streak = 0
    for msg in reversed(state.get("history", [])):
        if msg["speaker"] != "customer":
            continue
        if (msg["text"] or "").strip() in _MIN_RESPONSE:
            streak += 1
        else:
            break
    return streak + 1  # 이번 턴 포함


def _canon_tactic(value: str) -> str:
    """LLM 전략 문자열을 signals.Tactic 정규 라벨로. 카탈로그 밖이면 원문 보존(화면 표시용)."""
    tac = signals.to_tactic(value)
    return tac.value if tac else (value or "")


def _build_strategy(tactic_value: str, headline: str) -> Strategy:
    """classify 결과 → Strategy(tactic/headline/lead).

    lead(.slead)는 정규 Tactic일 때 signals.TACTIC_LEAD에서 결정적으로 채운다
    (SSOT-3 STRAT20 정본). 카탈로그 밖 전략이면 lead 생략(키 없음 — 하위호환).
    """
    tac = signals.to_tactic(tactic_value)
    strategy: Strategy = {
        "tactic": tac.value if tac else (tactic_value or ""),
        "headline": headline,
    }
    lead = signals.tactic_lead(tac)
    if lead:
        strategy["lead"] = lead
    return strategy


def _to_intent(value: str) -> Intent:
    """LLM 문자열 → Intent. 미상이면 UNCLEAR."""
    try:
        return Intent(value)
    except (ValueError, TypeError):
        return Intent.UNCLEAR


def _to_route(value: str) -> Route:
    """LLM 문자열 → Route. 미상이면 RESPOND."""
    try:
        return Route(value)
    except (ValueError, TypeError):
        return Route.RESPOND


def _render_history(state: CallState) -> str:
    """LLM 프롬프트용 history 직렬화."""
    lines = []
    for m in state.get("history", []):
        role = {"customer": "고객", "bot": "상담봇", "agent": "상담원"}.get(m["speaker"], m["speaker"])
        lines.append(f"{role}: {m['text']}")
    lines.append(f"고객: {state.get('customer_text', '')}")
    return "\n".join(lines)
