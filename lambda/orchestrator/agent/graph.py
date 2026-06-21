"""LangGraph 그래프 조립 / build_graph().

AGENT 모듈. 설계: docs/agent/LANGGRAPH-DESIGN.md §1, §5.

하이브리드 턴 처리 그래프:
  load_context → fast_route ─(룰)→ churn_score → route_intent → respond → compliance → detect_mot → persist
                            ├(애매)→ classify ┘
                            └(침묵)→ silence ──────────────────────────────────────────────→ persist

모듈 로드 시 1회 compile 해 인보케이션 간 재사용(콜드스타트 절감).
"""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from . import nodes
from .state import CallState


def build_graph():
    """노드/엣지를 조립하고 compile 된 그래프를 반환."""
    g = StateGraph(CallState)

    # ── 노드 등록 ────────────────────────────────────────────────────────────
    g.add_node("load_context", nodes.load_context)
    g.add_node("fast_route", nodes.fast_route)
    g.add_node("classify", nodes.classify)
    g.add_node("churn_score", nodes.churn_score)
    g.add_node("respond", nodes.respond)
    g.add_node("compliance", nodes.compliance)
    g.add_node("detect_mot", nodes.detect_mot)
    g.add_node("transfer_node", nodes.transfer_node)
    g.add_node("close_node", nodes.close_node)
    g.add_node("silence", nodes.silence)
    g.add_node("persist", nodes.persist)

    # ── 엣지 ──────────────────────────────────────────────────────────────────
    g.add_edge(START, "load_context")
    g.add_edge("load_context", "fast_route")

    # fast_route: 룰로 확정 → churn_score / 애매 → classify / 침묵 → silence
    g.add_conditional_edges(
        "fast_route",
        nodes.fast_route_branch,
        {"classify": "classify", "silence": "silence", "churn_score": "churn_score"},
    )
    g.add_edge("classify", "churn_score")

    # churn 이후 최종 라우팅
    g.add_conditional_edges(
        "churn_score",
        nodes.route_intent,
        {
            "respond": "respond",
            "transfer_node": "transfer_node",
            "close_node": "close_node",
            "silence": "silence",
        },
    )

    # 정상 응답 경로: respond → compliance → detect_mot → persist
    g.add_edge("respond", "compliance")
    g.add_edge("compliance", "detect_mot")
    g.add_edge("detect_mot", "persist")

    # 종단 노드는 detect_mot를 거쳐(전환 MOT 기록) persist로 수렴
    g.add_edge("transfer_node", "detect_mot")
    g.add_edge("close_node", "persist")
    g.add_edge("silence", "persist")

    g.add_edge("persist", END)

    return g.compile()


# 모듈 로드 시 1회 compile (Lambda 콜드스타트 간 재사용)
GRAPH = build_graph()
