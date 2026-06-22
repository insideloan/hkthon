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
