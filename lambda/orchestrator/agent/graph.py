"""LangGraph 그래프 조립 / build_graph().

AGENT 모듈. 설계: docs/agent/LANGGRAPH-DESIGN.md §1, §5.

하이브리드 턴 처리 그래프:
  load_context → fast_route ─(룰)→ churn_score → route_intent → respond → compliance → detect_mot → persist
                            ├(애매)→ classify ┘
                            └(침묵)→ silence ──────────────────────────────────────────────→ persist

모듈 로드 시 1회 compile 해 인보케이션 간 재사용(콜드스타트 절감).
"""

from __future__ import annotations

import logging
import os
import time

from langgraph.graph import END, START, StateGraph

from . import nodes
from .state import CallState

logger = logging.getLogger(__name__)
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))


def _timed(name, fn):
    """노드 실행 시간(ms)을 구조화 로그로 남기는 래퍼.

    라이브 한 턴(~20-37s)의 노드별 분해를 CloudWatch에서 바로 볼 수 있게 한다.
    LLM 노드(classify/respond/compliance)가 대부분의 시간을 쓰므로,
    이 로그로 어느 호출이 느린지 즉시 식별된다. 로그 형식(고정 prefix + key=val)은
    CloudWatch Logs Insights 파싱을 쉽게 하려는 것.
    """

    def wrapped(state):
        t0 = time.perf_counter()
        try:
            return fn(state)
        finally:
            ms = (time.perf_counter() - t0) * 1000.0
            logger.info("node_timing node=%s ms=%.1f", name, ms)

    return wrapped


def build_graph():
    """노드/엣지를 조립하고 compile 된 그래프를 반환."""
    g = StateGraph(CallState)

    # ── 노드 등록 (각 노드를 _timed로 감싸 노드별 소요시간 로깅) ─────────────────
    g.add_node("load_context", _timed("load_context", nodes.load_context))
    g.add_node("fast_route", _timed("fast_route", nodes.fast_route))
    g.add_node("classify", _timed("classify", nodes.classify))
    g.add_node("detect_fraud", _timed("detect_fraud", nodes.detect_fraud))
    g.add_node("churn_score", _timed("churn_score", nodes.churn_score))
    g.add_node("respond", _timed("respond", nodes.respond))
    g.add_node("compliance", _timed("compliance", nodes.compliance))
    g.add_node("detect_mot", _timed("detect_mot", nodes.detect_mot))
    g.add_node("intake_node", _timed("intake_node", nodes.intake_node))
    g.add_node("close_node", _timed("close_node", nodes.close_node))
    g.add_node("silence", _timed("silence", nodes.silence))
    g.add_node("persist", _timed("persist", nodes.persist))

    # ── 엣지 ──────────────────────────────────────────────────────────────────
    g.add_edge(START, "load_context")
    g.add_edge("load_context", "fast_route")

    # fast_route: 룰로 확정 → churn_score / 애매 → classify / 침묵 → silence
    g.add_conditional_edges(
        "fast_route",
        nodes.fast_route_branch,
        {"classify": "classify", "silence": "silence", "churn_score": "churn_score"},
    )
    # classify(LLM) 경로는 detect_fraud를 경유해 fraud 플래그를 보강한 뒤 churn_score로.
    # detect_fraud는 분기 없는 경유 노드 — 라우팅을 바꾸지 않는다(통화 계속).
    g.add_edge("classify", "detect_fraud")
    g.add_edge("detect_fraud", "churn_score")

    # churn 이후 최종 라우팅
    g.add_conditional_edges(
        "churn_score",
        nodes.route_intent,
        {
            "respond": "respond",
            "intake_node": "intake_node",
            "close_node": "close_node",
            "silence": "silence",
        },
    )

    # 정상 응답 경로: respond → compliance → detect_mot → persist
    g.add_edge("respond", "compliance")
    g.add_edge("compliance", "detect_mot")
    g.add_edge("detect_mot", "persist")

    # 종단 노드는 detect_mot를 거쳐(전환 MOT 기록) persist로 수렴
    g.add_edge("intake_node", "detect_mot")
    g.add_edge("close_node", "persist")
    g.add_edge("silence", "persist")

    g.add_edge("persist", END)

    return g.compile()


# 모듈 로드 시 1회 compile (Lambda 콜드스타트 간 재사용)
GRAPH = build_graph()
