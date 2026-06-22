"""Resolver 공통 유틸 (BACKEND).

시각 포맷, Call 상태 머신, DynamoDB(snake) ↔ GraphQL(camel) 마샬링 헬퍼.
"""

from __future__ import annotations

import time

# Call 상태 머신 (API.md §0.2). 액션별 허용 상태 검증에 사용.
CALL_STATES = {"CREATED", "DIALING", "IN_CALL", "TRANSFER_PENDING", "ENDED"}
# 진행 중(새 발신 불가)으로 간주하는 상태.
ACTIVE_STATES = {"DIALING", "IN_CALL", "TRANSFER_PENDING"}


def now_iso() -> str:
    """ISO-8601 UTC 타임스탬프. (Date.now 미사용 — time.gmtime 기반.)"""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def call_id_from(ts_ms: int) -> str:
    return f"c{ts_ms}"


def new_call_id() -> str:
    return call_id_from(int(time.time() * 1000))
