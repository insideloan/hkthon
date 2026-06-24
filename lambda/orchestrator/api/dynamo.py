"""DynamoDB 싱글 테이블 액세스 레이어.

BACKEND 모듈 (#21). 모든 resolver/핸들러가 공유하는 공통 클라이언트.
boto3 리소스를 dependency-injectable하게 추상화 — 테스트는 `set_table()`로
fake 테이블을 주입한다 (moto 의존성 없이 단위 테스트 가능; requirements.txt는
TEAM-LOCK이고 CI가 moto를 설치하지 않으므로 의도적으로 boto3만 사용).

PK/SK 패턴 (SSOT: docs/reference/API.md §5, DATA 모델 모양):
  CUST#{id}            / META
  CALL#{id}            / META
  CALL#{id}            / TURN#{seq:04d}
  CALL#{id}            / MOT#{seq:04d}
  CALL#{id}            / CMPL#{turnSeq}#{tryIndex}
  CALL#{id}            / SUMMARY
  PROD#{id}            / META
"""

from __future__ import annotations

import os
from typing import Any, Optional

_table = None  # lazy / injectable singleton


class ConditionalCheckFailedError(RuntimeError):
    """put_item의 ConditionExpression이 거짓 — 동시 write 충돌(이미 존재하는 키 등).

    audioChunk가 customer Turn을 attribute_not_exists(SK) 조건으로 쓸 때, 동시에
    뜬 다른 invocation이 같은 seq를 선점했으면 이 예외가 난다 → 호출측이 재조회·재시도.
    """


# ─────────────────────────────────────────────────────────────────────────────
# PK/SK 키 빌더 (싱글 테이블 패턴 상수)
# ─────────────────────────────────────────────────────────────────────────────


def pk_call(call_id: str) -> str:
    return f"CALL#{call_id}"


def pk_cust(customer_id: str) -> str:
    return f"CUST#{customer_id}"


def pk_prod(product_id: str) -> str:
    return f"PROD#{product_id}"


# 큐 인덱스 파티션 (관리자 대시보드 스냅샷). dialCall/상태변경이 갱신,
# queue resolver가 조회. SK = CALL#{id}.
PK_QUEUE = "QUEUE"


def sk_call(call_id: str) -> str:
    return f"CALL#{call_id}"


SK_META = "META"
SK_SUMMARY = "SUMMARY"
SK_PREFIX_CALL = "CALL#"


def sk_turn(seq: int) -> str:
    return f"TURN#{seq:04d}"


def sk_mot(seq: int) -> str:
    return f"MOT#{seq:04d}"


def sk_cmpl(turn_seq: int, try_index: int) -> str:
    return f"CMPL#{turn_seq}#{try_index}"


# SK prefix 상수 (begins_with 쿼리용)
SK_PREFIX_TURN = "TURN#"
SK_PREFIX_MOT = "MOT#"
SK_PREFIX_CMPL = "CMPL#"


# ─────────────────────────────────────────────────────────────────────────────
# 테이블 accessor (DI 가능)
# ─────────────────────────────────────────────────────────────────────────────


def get_table():
    """DynamoDB Table 리소스 반환 (lazy singleton).

    테스트는 `set_table(fake)`로 주입; 그 외에는 boto3 resource를 lazy 생성.
    """
    global _table
    if _table is None:
        import boto3

        name = os.environ.get("TABLE_NAME")
        if not name:
            raise RuntimeError("TABLE_NAME env not set and no table injected")
        _table = boto3.resource("dynamodb").Table(name)
    return _table


def set_table(table) -> None:
    """테스트/DI용 테이블 주입. None이면 리셋(다음 get_table이 boto3 재생성)."""
    global _table
    _table = table


# ─────────────────────────────────────────────────────────────────────────────
# CRUD 헬퍼
# ─────────────────────────────────────────────────────────────────────────────


def put_item(item: dict[str, Any]) -> dict[str, Any]:
    """단일 아이템 저장. PK/SK 필수."""
    if "PK" not in item or "SK" not in item:
        raise ValueError("item must include PK and SK")
    get_table().put_item(Item=item)
    return item


def put_item_if_absent(item: dict[str, Any]) -> dict[str, Any]:
    """동일 (PK, SK)가 아직 없을 때만 저장 (조건부 write). PK/SK 필수.

    동시 audioChunk가 같은 seq로 customer Turn을 쓰려 할 때 한 쪽만 성공시켜
    seq 중복 발급(→ TTS S3 키 충돌·프론트 멱등 차단)을 막는다. 이미 존재하면
    ConditionalCheckFailedError를 던져 호출측이 seq를 다시 계산해 재시도하게 한다.
    """
    if "PK" not in item or "SK" not in item:
        raise ValueError("item must include PK and SK")
    try:
        get_table().put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(PK) AND attribute_not_exists(SK)",
        )
    except Exception as exc:  # noqa: BLE001 — boto3 ClientError 또는 fake의 충돌 예외
        if _is_conditional_check_failed(exc):
            raise ConditionalCheckFailedError(str(exc)) from exc
        raise
    return item


def _is_conditional_check_failed(exc: Exception) -> bool:
    """예외가 DynamoDB ConditionalCheckFailedException인지 (boto3/fake 양쪽 판별)."""
    if isinstance(exc, ConditionalCheckFailedError):
        return True
    # boto3 ClientError: response.Error.Code == "ConditionalCheckFailedException"
    code = getattr(exc, "response", {}).get("Error", {}).get("Code") if hasattr(exc, "response") else None
    return code == "ConditionalCheckFailedException"


def get_item(pk: str, sk: str) -> Optional[dict[str, Any]]:
    """PK/SK로 단건 조회. 없으면 None."""
    resp = get_table().get_item(Key={"PK": pk, "SK": sk})
    return resp.get("Item")


def delete_item(pk: str, sk: str) -> None:
    """PK/SK 단건 삭제. 멱등 — 없는 키를 지워도 에러 없음."""
    get_table().delete_item(Key={"PK": pk, "SK": sk})


def query(pk: str, sk_prefix: Optional[str] = None) -> list[dict[str, Any]]:
    """PK 기준 아이템 목록 조회. sk_prefix 주면 begins_with 필터.

    boto3 Table.query 인터페이스 사용. 페이지네이션은 데모 규모에선 단순화
    (LastEvaluatedKey 루프 — 큰 콜은 없음).
    """
    from boto3.dynamodb.conditions import Key

    cond = Key("PK").eq(pk)
    if sk_prefix:
        cond = cond & Key("SK").begins_with(sk_prefix)

    items: list[dict[str, Any]] = []
    kwargs: dict[str, Any] = {"KeyConditionExpression": cond}
    while True:
        resp = get_table().query(**kwargs)
        items.extend(resp.get("Items", []))
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        kwargs["ExclusiveStartKey"] = lek
    return items


def scan(sk: Optional[str] = None) -> list[dict[str, Any]]:
    """전체 테이블 스캔. sk 주면 해당 SK 아이템만(FilterExpression) 반환.

    데모 규모(아이템 수십 개) 전용 — 큐 인덱스가 비었을 때의 fallback 경로다.
    상시 핫패스는 query(PK_QUEUE, ...)이며 scan은 booth 콜드스타트 보호용.
    """
    from boto3.dynamodb.conditions import Attr

    items: list[dict[str, Any]] = []
    kwargs: dict[str, Any] = {}
    if sk is not None:
        kwargs["FilterExpression"] = Attr("SK").eq(sk)
    while True:
        resp = get_table().scan(**kwargs)
        items.extend(resp.get("Items", []))
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        kwargs["ExclusiveStartKey"] = lek
    return items


def update_fields(pk: str, sk: str, fields: dict[str, Any]) -> dict[str, Any]:
    """주어진 필드만 SET 업데이트. 갱신된 아이템(ALL_NEW) 반환."""
    if not fields:
        return get_item(pk, sk) or {}
    names = {f"#k{i}": k for i, k in enumerate(fields)}
    values = {f":v{i}": v for i, v in enumerate(fields.values())}
    set_expr = ", ".join(f"{n} = :v{i}" for i, n in enumerate(names))
    resp = get_table().update_item(
        Key={"PK": pk, "SK": sk},
        UpdateExpression=f"SET {set_expr}",
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
        ReturnValues="ALL_NEW",
    )
    return resp.get("Attributes", {})
