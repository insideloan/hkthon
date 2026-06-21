"""AGENT-004 (#12) — LangGraph CallState + graph 스켈레톤 검증.

langgraph 미설치 환경에서는 skip (라이브 모드 전용 의존성).
"""

import pytest

pytest.importorskip("langgraph", reason="langgraph는 라이브 모드 전용 의존성")


def test_build_graph_compiles():
    """build_graph()가 컴파일된 그래프를 반환."""
    from orchestrator.agent.graph import build_graph

    graph = build_graph()
    assert graph is not None
    # 컴파일된 그래프는 invoke 가능해야 함
    assert hasattr(graph, "invoke")


def test_module_level_graph_singleton():
    """모듈 로드 시 1회 compile된 GRAPH 재사용 가능."""
    from orchestrator.agent import graph

    assert graph.GRAPH is not None
