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
    return {
        "callId": call_id,
        "seq": item.get("seq"),
        "speaker": item.get("speaker"),
        "text": item.get("text"),
        # AGENT stores "risk"/"def"/None; wire TurnFlag enum is RISK/DEF/NEUTRAL.
        "flag": _TURN_FLAG.get(item.get("flag"), "NEUTRAL"),
        "tokens": item.get("tokens") or [],
    }


def _mot_payload(item: dict) -> dict:
    call_id = (item.get("PK") or "").removeprefix("CALL#")
    payload = mot_out(item)
    payload["callId"] = call_id
    return payload


def _compliance_payload(item: dict) -> dict:
    call_id = (item.get("PK") or "").removeprefix("CALL#")
    # AGENT stores state lowercase ("drafting"...); wire enum is uppercase.
    state = item.get("state")
    return {
        "callId": call_id,
        "state": state.upper() if isinstance(state, str) else state,
        "draft": item.get("draft"),
        # 부가 필드(_emit 인자 화이트리스트 밖) — 구독 onComplianceState resolver/표시용.
        "violatedPolicies": item.get("violated_policies") or [],
        "finalDiff": item.get("final_text"),
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
        # 분석값이 함께 들어오면 index/speech도 발화.
        if new.get("churn_after") is not None or new.get("emotion") is not None:
            call_id = (new.get("PK") or "").removeprefix("CALL#")
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
            emits.append(_emit("_emitCallEnded", {"callId": call_id}))
        emits.append(_emit("_emitQueueUpdate", {"callId": call_id,
                                                "state": new.get("state")}))
        if new.get("strategy_headline") is not None:
            emits.append(_emit("_emitStrategyUpdate", {
                "callId": call_id,
                "strategyHeadline": new.get("strategy_headline"),
                "rationale": new.get("rationale"),
            }))
    return emits


def handler(event: dict, context: Any = None) -> dict:
    """Streams Lambda 엔트리. event["Records"] 전체를 팬아웃."""
    all_emits: list[dict] = []
    for record in event.get("Records", []):
        try:
            all_emits.extend(_dispatch_record(record))
        except Exception:  # noqa: BLE001 — 한 레코드 실패가 배치를 막지 않게
            logger.exception("fanout failed for record")
    return {"emitted": len(all_emits), "emits": all_emits}
