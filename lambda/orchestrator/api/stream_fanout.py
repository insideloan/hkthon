"""DynamoDB Streams → AppSync 구독 팬아웃 (BACKEND #28).

DynamoDB Streams 이벤트를 받아 엔터티 유형(SK 패턴)에 따라 AppSync `_emit*`
뮤테이션을 호출한다. AppSync 구독은 이 _emit 뮤테이션에 `@aws_subscribe`로
연결되어 클라이언트로 팬아웃된다. 별도 WebSocket 서버 없음.

구독 페이로드 형상은 SSOT-3 정합 (graphql/schema.graphql):
  onTurn / onIndexUpdate / onSpeechAnalysis / onStrategyUpdate /
  onComplianceState / onMotDetected / onCallEnded / onQueueUpdate
"""

from __future__ import annotations

import logging
import os
from typing import Any, Callable, Optional

from ..resolvers.mots import mot_out

logger = logging.getLogger(__name__)
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

# AGENT turn flag("risk"|"def"|None) → wire TurnFlag enum.
_TURN_FLAG = {"risk": "RISK", "def": "DEF", None: "NEUTRAL"}


def _deserialize(image: dict) -> dict:
    """DynamoDB Streams NewImage(타입 태그 포함)를 평범한 dict로 변환.

    boto3 TypeDeserializer를 쓰되, 미설치/단위테스트에서는 이미 평탄화된 dict를
    그대로 받는 경로도 허용한다(값에 타입태그 키가 없으면 평탄으로 간주).
    """
    if not image:
        return {}
    sample = next(iter(image.values()))
    if not (isinstance(sample, dict) and len(sample) == 1
            and next(iter(sample)) in {"S", "N", "BOOL", "M", "L", "NULL", "SS", "NS"}):
        return dict(image)  # already plain
    from boto3.dynamodb.types import TypeDeserializer

    d = TypeDeserializer()
    return {k: d.deserialize(v) for k, v in image.items()}


# ─────────────────────────────────────────────────────────────────────────────
# 페이로드 빌더 (엔터티 → 구독 payload)
# ─────────────────────────────────────────────────────────────────────────────


def _turn_payload(item: dict) -> dict:
    call_id = (item.get("PK") or "").removeprefix("CALL#")
    payload = {
        "callId": call_id,
        "seq": item.get("seq"),
        "speaker": item.get("speaker"),
        "text": item.get("text"),
        # AGENT stores "risk"/"def"/None; wire TurnFlag enum is RISK/DEF/NEUTRAL.
        "flag": _TURN_FLAG.get(item.get("flag"), "NEUTRAL"),
        "tokens": item.get("tokens") or [],
    }
    # 봇 발화 TTS mp3 presigned URL(persist가 기록). bot Turn에만 있고 customer Turn엔 없다.
    audio_url = item.get("audio_url")
    if audio_url:
        payload["audioUrl"] = audio_url
    return payload


def _mot_payload(item: dict) -> dict:
    call_id = (item.get("PK") or "").removeprefix("CALL#")
    payload = mot_out(item)
    payload["callId"] = call_id
    return payload


# 4규제 카탈로그 (SSOT-3 카드③ COMPLIANCE). 위반 정책 라벨 → 이 카탈로그의 flagged 매핑.
_COMPLIANCE_LAWS = [
    {"law": "금융소비자보호법", "desc": "확정·과장 표현 점검"},
    {"law": "개인정보법", "desc": "불필요 정보 요청 점검"},
    {"law": "신용정보법", "desc": "활용 범위 준수 점검"},
    {"law": "표현리스크", "desc": "오해·강요 문구 점검"},
]


def _compliance_payload(item: dict) -> dict:
    """CMPL 아이템 → onComplianceState payload (SSOT-3 풍부 형상).

    AGENT는 state/draft/violated_policies/final_text만 기록한다. 4규제 checks와
    최종 diff(final)는 여기서 구성한다:
      - checks: 4규제 카탈로그 각각에 대해 violated_policies 포함 여부로 flagged 산출.
        단 reviewing 이전(drafting)에는 미검토(flagged=None).
      - final: final_text가 있으면 단일 세그먼트로(diff 산출은 향후 확장 여지).
    """
    call_id = (item.get("PK") or "").removeprefix("CALL#")
    state = item.get("state")
    phase = state.upper() if isinstance(state, str) else state  # wire enum은 대문자
    violated = item.get("violated_policies") or []
    reviewed = isinstance(state, str) and state.lower() != "drafting"

    checks = [
        {
            "law": law["law"],
            "desc": law["desc"],
            # 미검토(drafting)=None, 검토 후=위반 목록에 law 라벨이 있으면 True.
            "flagged": (law["law"] in violated) if reviewed else None,
        }
        for law in _COMPLIANCE_LAWS
    ]

    final_text = item.get("final_text")
    final = [{"text": final_text}] if final_text else []

    return {
        "callId": call_id,
        "phase": phase,
        "draft": item.get("draft"),
        "violations": list(violated),       # 가안에서 강조할 위반 표현(라벨 재사용)
        "checks": checks,
        "violatedPolicies": list(violated),
        "final": final,
    }


def _emit(mutation: str, payload: dict) -> dict:
    """AppSync `_emit*` 뮤테이션 호출.

    주입된 emit 함수(`set_appsync_emit`)가 있으면 그것을 쓰고, 없으면 기본
    SigV4 AppSync 클라이언트(`appsync_emit.emit`)를 지연 로드해 호출한다.
    단위 테스트는 set_appsync_emit으로 mock을 주입하거나 _DISABLE_EMIT로 끈다.
    한 emit 실패가 배치 전체를 막지 않도록 예외는 삼킨다.
    """
    logger.info("emit %s: %s", mutation, payload)
    fn = _appsync_emit
    if fn is None and not _DISABLE_EMIT:
        from . import appsync_emit
        fn = appsync_emit.emit
    if fn is not None:
        try:
            fn(mutation, payload)
        except Exception:  # noqa: BLE001 — 한 emit 실패가 팬아웃 배치를 막지 않게
            logger.exception("AppSync emit failed: %s", mutation)
    return {"mutation": mutation, "payload": payload}


# AppSync emit 함수 주입점. 라이브 배포에서는 None이면 appsync_emit.emit을 자동 사용.
# 테스트에서 mock을 주입하거나, _DISABLE_EMIT=True로 외부 호출을 완전히 끈다.
_appsync_emit: Optional[Callable[[str, dict], Any]] = None
_DISABLE_EMIT: bool = False


def set_appsync_emit(fn: Optional[Callable[[str, dict], Any]]) -> None:
    global _appsync_emit
    _appsync_emit = fn


# ─────────────────────────────────────────────────────────────────────────────
# 디스패치
# ─────────────────────────────────────────────────────────────────────────────


def _dispatch_record(record: dict) -> list[dict]:
    """단일 Streams 레코드 → 발화된 emit 목록."""
    event_name = record.get("eventName")  # INSERT | MODIFY | REMOVE
    ddb = record.get("dynamodb", {})
    new = _deserialize(ddb.get("NewImage", {}))
    if not new:
        return []
    sk = new.get("SK", "")
    emits: list[dict] = []

    if sk.startswith("TURN#"):
        emits.append(_emit("_emitTurn", _turn_payload(new)))
        call_id = (new.get("PK") or "").removeprefix("CALL#")
        # 발화분석: 턴에 분석 토큰이 있으면 onSpeechAnalysis도 발화(카드① 채움).
        tokens = new.get("tokens") or []
        if tokens:
            emits.append(_emit("_emitSpeechAnalysis", {
                "callId": call_id,
                "turnSeq": new.get("seq"),
                "tokens": _token_inputs(tokens),
            }))
        # 분석값이 함께 들어오면 index도 발화.
        if new.get("churn_after") is not None or new.get("emotion") is not None:
            emits.append(_emit("_emitIndexUpdate", {
                "callId": call_id,
                "churnRisk": new.get("churn_after"),
                "emotion": new.get("emotion"),
            }))
    elif sk.startswith("MOT#") and event_name == "INSERT":
        emits.append(_emit("_emitMot", _mot_payload(new)))
    elif sk.startswith("CMPL#"):
        emits.append(_emit("_emitComplianceState", _compliance_payload(new)))
    elif sk == "META":
        # Call 상태 변경 → 종료/큐 갱신.
        call_id = new.get("callId")
        if new.get("state") == "ENDED":
            emits.append(_emit("_emitCallEnded", {
                "callId": call_id,
                "resultType": _result_type(new),
                "endedAt": new.get("ended_at"),
            }))
        emits.append(_emit("_emitQueueUpdate", {"callId": call_id,
                                                "state": new.get("state")}))
        if new.get("strategy_headline") is not None:
            emits.append(_emit("_emitStrategyUpdate", {
                "callId": call_id,
                "turnSeq": new.get("last_seq"),
                "strategyHeadline": new.get("strategy_headline"),
                "rationale": new.get("rationale"),
            }))
    return emits


def _token_inputs(tokens: list) -> list[dict]:
    """churn_tokens → TokenInput 형상(text/polarity/reason)으로 정규화."""
    out = []
    for t in tokens:
        if not isinstance(t, dict):
            continue
        out.append({
            "text": t.get("text") or "",
            "polarity": t.get("polarity"),
            "reason": t.get("reason") or "",
        })
    return out


def _result_type(meta: dict) -> str | None:
    """종료된 콜 META → onCallEnded resultType(한도조회_상담원연결|가입승인|거절).

    AGENT가 result_type을 직접 기록하면 그대로 쓰고, 없으면 핸드오프/승인 흔적으로 추론.
    """
    explicit = meta.get("result_type")
    if explicit:
        return explicit
    if meta.get("handoff_reason") or meta.get("agent_joined_at"):
        return "한도조회_상담원연결"
    if meta.get("approved_product_id"):
        return "가입승인"
    return None


def handler(event: dict, context: Any = None) -> dict:
    """Streams Lambda 엔트리. event["Records"] 전체를 팬아웃."""
    all_emits: list[dict] = []
    for record in event.get("Records", []):
        try:
            all_emits.extend(_dispatch_record(record))
        except Exception:  # noqa: BLE001 — 한 레코드 실패가 배치를 막지 않게
            logger.exception("fanout failed for record")
    return {"emitted": len(all_emits), "emits": all_emits}
