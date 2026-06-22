"""BACKEND-001 (#20) — handler 디스패치 + config smoke test."""

from __future__ import annotations

import importlib

from orchestrator import handler as h
from orchestrator.api import config


def test_ping_smoke():
    """합성 AppSync 이벤트(fieldName=ping) → 정상 응답."""
    resp = h.handler({"fieldName": "ping", "arguments": {}}, None)
    assert resp == {"ok": True}


def test_unknown_field_returns_internal_error():
    """알 수 없는 fieldName → INTERNAL 에러 응답 (예외 미발생)."""
    resp = h.handler({"fieldName": "noSuchField", "arguments": {}}, None)
    assert resp["error"] is True
    assert resp["errorType"] == "INTERNAL"


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


def test_resolver_error_maps_to_error_type(monkeypatch):
    """OrchestratorError → errorType 매핑."""
    def boom(event, args):
        raise h.OrchestratorError("NOT_FOUND", "nope")

    monkeypatch.setattr(h, "_resolver_map", lambda: {"x": boom})
    resp = h.handler({"fieldName": "x"}, None)
    assert resp["errorType"] == "NOT_FOUND"


def test_module_imports_clean():
    """핸들러 모듈 재import 가능 (콜드스타트 안전)."""
    importlib.reload(h)
