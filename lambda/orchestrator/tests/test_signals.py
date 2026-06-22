"""AGENT-005 신호 분류 체계(signals.py) + classify 통합 검증.

SSOT: docs/상담엔진_ver1.xlsx '상담엔진 신호'.
엄격 Enum: 카탈로그 밖 값은 None 폴백, 한국어 라벨/영문 멤버명 모두 허용.
"""

from orchestrator.agent import signals
from orchestrator.agent.signals import (
    DEMO_PROFILE,
    DemoCase,
    Emotion,
    Need,
    Tactic,
    Usability,
)


# ─────────────────────────────────────────────────────────────────────────────
# 카탈로그 크기 — xlsx 정의 수와 일치 (15/15/20/20)
# ─────────────────────────────────────────────────────────────────────────────


def test_catalog_sizes_match_xlsx():
    assert len(Emotion) == 15
    assert len(Need) == 15
    assert len(Usability) == 20
    assert len(Tactic) == 20


def test_every_member_has_catalog_meta():
    """모든 Enum 멤버는 상세정의/대표발화 메타를 가진다(누락 방지)."""
    assert set(signals.EMOTION_DEF) == set(Emotion)
    assert set(signals.NEED_DEF) == set(Need)
    assert set(signals.USABILITY_DEF) == set(Usability)
    assert set(signals.TACTIC_DEF) == set(Tactic)


# ─────────────────────────────────────────────────────────────────────────────
# 안전 파서 — 한국어 라벨 / 영문 멤버명 / 폴백
# ─────────────────────────────────────────────────────────────────────────────


def test_coerce_accepts_korean_label():
    assert signals.to_emotion("부담") == Emotion.BURDENED
    assert signals.to_need("월납입 절감") == Need.LOWER_PAYMENT
    assert signals.to_usability("상담원 연결 필요") == Usability.NEEDS_AGENT
    assert signals.to_tactic("대환 제안 전략") == Tactic.PROPOSE_REFINANCE


def test_coerce_accepts_english_member_name():
    assert signals.to_emotion("BURDENED") == Emotion.BURDENED
    assert signals.to_tactic("build_trust") == Tactic.BUILD_TRUST


def test_coerce_out_of_catalog_returns_none():
    assert signals.to_emotion("행복함") is None
    assert signals.to_need("우주여행") is None
    assert signals.to_tactic("아무거나전략") is None


def test_coerce_empty_returns_none():
    for fn in (signals.to_emotion, signals.to_need, signals.to_usability, signals.to_tactic):
        assert fn("") is None
        assert fn(None) is None


def test_labels_returns_korean_values():
    labels = signals.labels(Emotion)
    assert "부담" in labels and "짜증" in labels
    assert len(labels) == 15


# ─────────────────────────────────────────────────────────────────────────────
# 시연 케이스 프로파일 — 데모 3종 매핑 무결성
# ─────────────────────────────────────────────────────────────────────────────


def test_demo_profiles_cover_all_cases():
    assert set(DEMO_PROFILE) == set(DemoCase)


def test_demo_profile_values_are_valid_signals():
    for case, prof in DEMO_PROFILE.items():
        assert isinstance(prof["emotion"], Emotion)
        assert isinstance(prof["need"], Need)
        assert isinstance(prof["usability"], Usability)
        assert isinstance(prof["tactic"], Tactic)


def test_refinance_demo_profile():
    """대환 관심 고객 → 부담/월납입절감/비교후판단/대환제안."""
    prof = DEMO_PROFILE[DemoCase.REFINANCE_INTEREST]
    assert prof["emotion"] == Emotion.BURDENED
    assert prof["tactic"] == Tactic.PROPOSE_REFINANCE
