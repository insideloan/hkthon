"""AppSync `_emit*` 뮤테이션 호출 클라이언트 (SigV4 서명, BACKEND #28).

Streams 팬아웃(stream_fanout)이 이 클라이언트로 AppSync에 `_emit*` 뮤테이션을
보내면, `@aws_subscribe`로 연결된 구독이 클라이언트로 팬아웃된다.

- 인증: IAM (SigV4). Lambda 실행 역할에 `appsync:GraphQL` 권한(infra)이 있어야 함.
- 의존성: botocore(런타임 내장)로 SigV4 서명, urllib(표준)로 HTTP POST.
  httpx/requests 불필요 — 콜드스타트/레이어 부담 최소화.
- 각 `_emit*` 뮤테이션은 스키마상 정해진 스칼라 인자만 받으므로, payload를
  뮤테이션별 인자 화이트리스트로 필터한 뒤 GraphQL variables로 전달한다.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

# 뮤테이션별 (인자명 → GraphQL 타입) — schema.graphql의 _emit* 시그니처와 정확히 일치.
# payload에서 이 키만 추려 variables로 보낸다 (부가 필드 제외).
# ⚠️ SSOT는 graphql/schema.graphql의 _emit* 시그니처다. 스키마가 바뀌면 여기도 갱신.
_EMIT_ARGS: dict[str, dict[str, str]] = {
    "_emitTurn": {"callId": "ID!", "seq": "Int", "speaker": "String",
                  "text": "String", "flag": "TurnFlag", "audioUrl": "String",
                  "tokens": "[TokenInput!]"},
    "_emitIndexUpdate": {"callId": "ID!", "churnRisk": "Int", "emotion": "String",
                         "dbChips": "[String!]", "dbNodes": "[DbNodeInput!]"},
    "_emitSpeechAnalysis": {"callId": "ID!", "turnSeq": "Int", "tokens": "[TokenInput!]"},
    "_emitStrategyUpdate": {"callId": "ID!", "turnSeq": "Int",
                            "strategyHeadline": "String!", "rationale": "String!"},
    "_emitComplianceState": {"callId": "ID!", "phase": "ComplianceStateEnum!",
                             "draft": "String", "violations": "[String!]",
                             "checks": "[ComplianceCheckInput!]",
                             "violatedPolicies": "[String!]",
                             "final": "[ComplianceFinalSegmentInput!]"},
    "_emitMot": {"callId": "ID!", "markerId": "MotMarkerId!", "state": "MotState!",
                 "stage": "MotStage!"},
    "_emitQueueUpdate": {"callId": "ID!", "state": "CallState"},
    "_emitCallEnded": {"callId": "ID!", "resultType": "String", "endedAt": "String"},
}

# 각 뮤테이션 응답 selection set — 구독 payload 타입의 전체 필드.
# ⚠️ AppSync @aws_subscribe는 "트리거 뮤테이션의 selection set에 포함된 필드만"
# 구독자에게 전달한다. 여기서 callId만 고르면 나머지 필드가 전부 null로 도착해
# 프론트 스키마 검증(Zod)이 깨진다. 각 payload 타입의 모든 필드를 골라야 한다.
_RETURN_FIELDS: dict[str, str] = {
    "_emitTurn": "callId seq speaker text flag tokens { text polarity reason } audioUrl",
    "_emitIndexUpdate": "callId churnRisk emotion dbChips dbNodes { label val tone }",
    "_emitSpeechAnalysis": "callId turnSeq tokens { text polarity reason }",
    "_emitStrategyUpdate": "callId turnSeq strategyHeadline rationale",
    "_emitComplianceState": ("callId phase draft violations "
                             "checks { law desc flagged } violatedPolicies "
                             "final { text del ins added }"),
    "_emitMot": "callId markerId state stage",
    "_emitQueueUpdate": "callId state",
    "_emitCallEnded": "callId resultType endedAt",
}


def _build_query(mutation: str, arg_types: dict[str, str]) -> str:
    """타입 지정 GraphQL 뮤테이션 문서 생성 ($var 선언 + 필드 전달 + payload selection)."""
    fields = _RETURN_FIELDS.get(mutation, "callId")
    if arg_types:
        var_decl = ", ".join(f"${k}: {t}" for k, t in arg_types.items())
        field_args = ", ".join(f"{k}: ${k}" for k in arg_types)
        return (f"mutation Emit({var_decl}) {{ "
                f"{mutation}({field_args}) {{ {fields} }} }}")
    return f"mutation Emit {{ {mutation} {{ {fields} }} }}"


def _filter_vars(mutation: str, payload: dict) -> dict:
    """payload에서 해당 뮤테이션이 받는 인자만 추출 (None 제외, 부가 필드 제거)."""
    allowed = _EMIT_ARGS.get(mutation, {})
    return {k: payload[k] for k in allowed if k in payload and payload[k] is not None}


def _json_default(o: Any):
    """json.dumps 보조: Decimal(DynamoDB 숫자) → int(정수) / float."""
    import decimal
    if isinstance(o, decimal.Decimal):
        return int(o) if o == o.to_integral_value() else float(o)
    raise TypeError(f"Object of type {o.__class__.__name__} is not JSON serializable")


def _endpoint() -> str:
    url = os.environ.get("APPSYNC_URL", "")
    if not url:
        raise RuntimeError("APPSYNC_URL env not set")
    return url


def _region() -> str:
    return os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION", "ap-northeast-2")


def _sign_and_post(url: str, body: bytes) -> dict:
    """SigV4(service=appsync)로 서명 후 POST. 응답 JSON dict 반환."""
    # 지연 import: 단위테스트는 emit 함수를 monkeypatch하므로 botocore 불필요.
    from botocore.auth import SigV4Auth
    from botocore.awsrequest import AWSRequest
    from botocore.session import Session

    session = Session()
    creds = session.get_credentials()
    if creds is None:
        raise RuntimeError("no AWS credentials for SigV4 signing")

    req = AWSRequest(method="POST", url=url, data=body,
                     headers={"Content-Type": "application/json"})
    SigV4Auth(creds.get_frozen_credentials(), "appsync", _region()).add_auth(req)

    http_req = urllib.request.Request(
        url, data=body, method="POST",
        headers={**dict(req.headers), "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(http_req, timeout=5) as resp:  # noqa: S310 (AppSync URL)
        return json.loads(resp.read().decode("utf-8"))


def emit(mutation: str, payload: dict) -> Any:
    """`_emit*` 뮤테이션을 AppSync에 전송. GraphQL errors가 있으면 로깅 후 무시.

    stream_fanout가 set_appsync_emit(emit)으로 주입해 사용한다.
    """
    variables = _filter_vars(mutation, payload)
    query = _build_query(mutation, _EMIT_ARGS.get(mutation, {}))
    # DynamoDB Streams의 숫자는 Decimal로 역직렬화된다 — json 기본 인코더가 처리
    # 못하므로 default 훅으로 int/float 변환.
    body = json.dumps({"query": query, "variables": variables},
                      default=_json_default).encode("utf-8")

    result = _sign_and_post(_endpoint(), body)
    if result.get("errors"):
        logger.error("AppSync emit %s errors: %s", mutation, result["errors"])
    return result
