"""BACKEND-001 (#20) — handler 디스패치 + config smoke test."""

from __future__ import annotations

import importlib

from orchestrator import handler as h
from orchestrator.api import config


def test_ping_smoke():
    """합성 AppSync 이벤트(fieldName=ping) → 정상 응답."""
    resp = h.handler({"fieldName": "ping", "arguments": {}}, None)
    assert resp == {"ok": True}


def test_unknown_field_raises_internal():
    """알 수 없는 fieldName → INTERNAL OrchestratorError raise (AppSync가 GraphQL error로 매핑)."""
    import pytest
    with pytest.raises(h.OrchestratorError) as ei:
        h.handler({"fieldName": "noSuchField", "arguments": {}}, None)
    assert ei.value.error_type == "INTERNAL"


def test_field_name_from_info_block():
    """info.fieldName 경로(패스스루)도 지원."""
    resp = h.handler({"info": {"fieldName": "ping"}}, None)
    assert resp == {"ok": True}


def test_settings_loads_env(monkeypatch):
    """Settings가 env 변수를 로드한다."""
    monkeypatch.setenv("TABLE_NAME", "T1")
    monkeypatch.setenv("ORCHESTRATOR_MODE", "live")
    config.get_settings.cache_clear()
    s = config.get_settings()
    assert s.table_name == "T1"
    assert s.is_live is True
    config.get_settings.cache_clear()


def test_resolver_error_reraised_with_code_in_message(monkeypatch):
    """OrchestratorError는 raise되어 AppSync가 GraphQL error로 매핑.

    errorType은 보존하되, AppSync errorType이 'Lambda:Unhandled'로 고정되므로
    message 앞에 코드를 실어("NOT_FOUND: ...") 클라이언트가 파싱하게 한다.
    """
    import pytest

    def boom(event, args):
        raise h.OrchestratorError("NOT_FOUND", "nope")

    monkeypatch.setattr(h, "_resolver_map", lambda: {"x": boom})
    with pytest.raises(h.OrchestratorError) as ei:
        h.handler({"fieldName": "x"}, None)
    assert ei.value.error_type == "NOT_FOUND"
    assert ei.value.message.startswith("NOT_FOUND:")


def test_module_imports_clean():
    """핸들러 모듈 재import 가능 (콜드스타트 안전)."""
    importlib.reload(h)


# ── admin _seed 필드 (aws lambda invoke 경로) ────────────────────────────────────


def _inject_fake_table():
    from orchestrator.api import dynamo
    from orchestrator.tests.test_seed import ConditionalFakeTable
    dynamo.set_table(ConditionalFakeTable())


def test_seed_field_seeds_all():
    """_seed(기본 what=all) → 고객 + 큐 둘 다 시드, 큐 스냅샷에 행이 보인다."""
    from orchestrator.api import dynamo
    from orchestrator.resolvers import queue
    _inject_fake_table()
    try:
        resp = h.handler({"fieldName": "_seed", "arguments": {}}, None)
        assert resp["ok"] is True
        assert resp["customers"] == 10
        assert resp["queue"] == 9
        assert queue.resolve_queue({}, {})["summary"]["total"] == 9
    finally:
        dynamo.set_table(None)


def test_seed_field_queue_only():
    """what=queue → 고객 시드는 건너뛰고 큐만."""
    from orchestrator.api import dynamo
    _inject_fake_table()
    try:
        resp = h.handler({"fieldName": "_seed", "arguments": {"what": "queue"}}, None)
        assert resp["customers"] is None
        assert resp["queue"] == 9
    finally:
        dynamo.set_table(None)


def test_seed_field_rejects_unknown_target():
    import pytest
    _inject_fake_table()
    from orchestrator.api import dynamo
    try:
        with pytest.raises(h.OrchestratorError) as ei:
            h.handler({"fieldName": "_seed", "arguments": {"what": "bogus"}}, None)
        assert ei.value.error_type == "INVALID_STATE"
    finally:
        dynamo.set_table(None)
