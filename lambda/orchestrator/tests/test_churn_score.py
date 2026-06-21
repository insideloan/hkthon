"""AGENT-001 (#9) — churn_risk 스코어러 baseline·EMA·clamp 검증."""

from orchestrator.agent import churn_risk as cr


def test_baseline_neutral_text_stays_near_50():
    """매칭 키워드 없는 발화는 baseline(50) 근처 유지."""
    after, tokens = cr.score("음 그냥요", 50)
    assert after == 50
    assert tokens == []


def test_ema_smoothing_alpha_06():
    """EMA: churn_after = round(0.6*turn_score + 0.4*churn_before).

    매칭 없으면 turn_score=50 → round(0.6*50 + 0.4*70) = round(58) = 58.
    """
    after, _ = cr.score("음", 70)
    assert after == 58


def test_cons_keyword_raises_risk():
    """이탈 신호(끊을게요)는 churn 상승 + CONS 토큰."""
    after, tokens = cr.score("그냥 끊을게요", 50)
    assert after > 50
    assert any(t["polarity"] == "CONS" for t in tokens)


def test_pro_keyword_lowers_risk():
    """성공경로 신호(상담원 연결)는 churn 하락 + PRO 토큰."""
    after, tokens = cr.score("상담원 연결해주세요", 70)
    assert after < 70
    assert any(t["polarity"] == "PRO" for t in tokens)


def test_score_clamped_0_100():
    """반복 강한 이탈 신호여도 0~100 범위."""
    after, _ = cr.score("관심없어요 끊을게요 필요없어요", 100)
    assert 0 <= after <= 100


def test_silence_penalty_applied_after_2_streak():
    """연속 무응답 2회↑ → silence_penalty(+6)가 turn_raw에 가산."""
    quiet, _ = cr.score("", 50, silence_streak=0)
    penalized, _ = cr.score("", 50, silence_streak=2)
    assert penalized > quiet


def test_llm_adjust_capped_at_10():
    """LLM 보정(adjust)은 ±10으로만 반영 (사전 점수 우선)."""
    base, _ = cr.score("음", 50)
    big, _ = cr.score("음", 50, adjust=50)   # 50을 줘도 +10까지만
    assert big - base == 10


def test_band_thresholds():
    assert cr.band(10) == "low"
    assert cr.band(50) == "medium"
    assert cr.band(80) == "high"
