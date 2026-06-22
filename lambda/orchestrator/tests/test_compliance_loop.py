"""AGENT-010 (#18) — Bedrock Guardrails 실호출 경로 검증 (mock boto3).

DynamoDB write(ComplianceReview)는 DATA-005(models) 완료 후 후속. 본 테스트는
Guardrails 실호출 파싱 + 룰 폴백 + 루프 재작성 경로에 집중한다.
"""

from orchestrator.agent import compliance as c
from orchestrator.agent.state import Stage


# ─────────────────────────────────────────────────────────────────────────────
# _bedrock_guardrails — 응답 파싱
# ─────────────────────────────────────────────────────────────────────────────


class _FakeBedrock:
    """apply_guardrail을 흉내내는 가짜 클라이언트."""

    def __init__(self, response=None, raises=None):
        self._response = response
        self._raises = raises
        self.calls = []

    def apply_guardrail(self, **kwargs):
        self.calls.append(kwargs)
        if self._raises:
            raise self._raises
        return self._response


def _use_fake(monkeypatch, fake):
    monkeypatch.setattr(c, "_bedrock", fake)  # lazy singleton 자리에 주입
    monkeypatch.setattr(c, "_bedrock_client", lambda: fake)


def test_guardrail_intervened_is_blocked(monkeypatch):
    fake = _FakeBedrock({
        "action": "GUARDRAIL_INTERVENED",
        "assessments": [{
            "contentPolicy": {"filters": [{"type": "MISCONDUCT", "action": "BLOCKED"}]},
        }],
    })
    _use_fake(monkeypatch, fake)
    v = c._bedrock_guardrails("무조건 됩니다")
    assert v["blocked"] is True
    assert "MISCONDUCT" in v["violated"]
    # OUTPUT source로 호출됐는지
    assert fake.calls[0]["source"] == "OUTPUT"


def test_guardrail_none_action_is_approved(monkeypatch):
    fake = _FakeBedrock({"action": "NONE", "assessments": []})
    _use_fake(monkeypatch, fake)
    v = c._bedrock_guardrails("상담원 연결해 드리겠습니다")
    assert v["blocked"] is False
    assert v["violated"] == []


def test_guardrail_extracts_pii_and_topic(monkeypatch):
    fake = _FakeBedrock({
        "action": "GUARDRAIL_INTERVENED",
        "assessments": [{
            "topicPolicy": {"topics": [{"name": "GUARANTEE", "action": "BLOCKED"}]},
            "sensitiveInformationPolicy": {"piiEntities": [{"type": "KR_RRN", "action": "ANONYMIZED"}]},
        }],
    })
    _use_fake(monkeypatch, fake)
    v = c._bedrock_guardrails("주민번호 알려주세요")
    assert "GUARANTEE" in v["violated"]
    assert "KR_RRN" in v["violated"]


def test_guardrail_exception_returns_none(monkeypatch):
    """API 예외 → None (호출측이 룰 폴백)."""
    fake = _FakeBedrock(raises=RuntimeError("network"))
    _use_fake(monkeypatch, fake)
    assert c._bedrock_guardrails("아무거나") is None


# ─────────────────────────────────────────────────────────────────────────────
# _apply_guardrails — Guardrail ID 설정 여부에 따른 분기
# ─────────────────────────────────────────────────────────────────────────────


def test_apply_uses_bedrock_when_id_set(monkeypatch):
    monkeypatch.setattr(c, "_GUARDRAIL_ID", "gr-123")
    fake = _FakeBedrock({"action": "GUARDRAIL_INTERVENED", "assessments": []})
    _use_fake(monkeypatch, fake)
    c._apply_guardrails("텍스트")
    assert fake.calls, "Guardrail ID가 있으면 Bedrock을 호출해야 함"


def test_apply_falls_back_to_rule_when_no_id(monkeypatch):
    """Guardrail ID 미설정 → 룰 검수만 (Bedrock 미호출)."""
    monkeypatch.setattr(c, "_GUARDRAIL_ID", None)
    v = c._apply_guardrails("한도는 3000만원입니다")  # 룰상 FIXED_FIGURE 위반
    assert v["blocked"] is True
    assert "FIXED_FIGURE" in v["violated"]


def test_apply_bedrock_error_falls_back_to_rule(monkeypatch):
    """Guardrail ID 있어도 호출 실패하면 룰 폴백."""
    monkeypatch.setattr(c, "_GUARDRAIL_ID", "gr-123")
    fake = _FakeBedrock(raises=RuntimeError("down"))
    _use_fake(monkeypatch, fake)
    v = c._apply_guardrails("고객님 무조건 됩니다")  # 룰상 CONFIRM_PROMISE
    assert v["blocked"] is True
    assert "CONFIRM_PROMISE" in v["violated"]


# ─────────────────────────────────────────────────────────────────────────────
# review_loop — Bedrock 경유 재작성 경로 (Acceptance)
# ─────────────────────────────────────────────────────────────────────────────


def test_loop_violation_then_redraft_passes(monkeypatch):
    """Bedrock이 1회 차단 → 재작성 → 통과 (Acceptance #1)."""
    monkeypatch.setattr(c, "_GUARDRAIL_ID", "gr-123")
    seq = [
        {"action": "GUARDRAIL_INTERVENED", "assessments": [
            {"contentPolicy": {"filters": [{"type": "MISCONDUCT", "action": "BLOCKED"}]}}]},
        {"action": "NONE", "assessments": []},  # 재작성본은 통과
    ]

    class _Seq(_FakeBedrock):
        def apply_guardrail(self, **kwargs):
            self.calls.append(kwargs)
            return seq[len(self.calls) - 1]

    fake = _Seq()
    _use_fake(monkeypatch, fake)
    monkeypatch.setattr(c.router, "converse", lambda *a, **k: "정정된 안내입니다")

    log, final = c.review_loop("무조건 됩니다", {"stage": Stage.PROPOSE})
    states = [s["state"] for s in log]
    assert "redacting" in states and "redrafting" in states
    assert states[-1] == "approved"
    assert final == "정정된 안내입니다"


def test_loop_exhausts_retries_then_fallback(monkeypatch):
    """계속 차단되면 최대 재시도 후 안전 fallback으로 종료 (Acceptance #2/#3)."""
    monkeypatch.setattr(c, "_GUARDRAIL_ID", "gr-123")
    fake = _FakeBedrock({"action": "GUARDRAIL_INTERVENED", "assessments": []})
    _use_fake(monkeypatch, fake)
    monkeypatch.setattr(c.router, "converse", lambda *a, **k: "여전히 무조건 됩니다")

    log, final = c.review_loop("무조건 됩니다", {"stage": Stage.PROPOSE})
    assert log[-1]["state"] == "approved"  # fallback도 approved 상태로 종료
    assert final  # 안전 문구 비어있지 않음


# ─────────────────────────────────────────────────────────────────────────────
# 이벤트 shape (SSOT-3) — reviewing.violatedPolicies + approved.draft/final_text
# ─────────────────────────────────────────────────────────────────────────────


def test_reviewing_step_carries_violated_policies(monkeypatch):
    """reviewing 단계 이벤트에 위반 정책 목록(violatedPolicies)이 실린다 (Acceptance #4).

    SSOT-3: CompliancePanel이 cmpChecks에 복수 규제 check를 표시.
    """
    monkeypatch.setattr(c, "_GUARDRAIL_ID", "gr-123")
    fake = _FakeBedrock({
        "action": "GUARDRAIL_INTERVENED",
        "assessments": [{
            "contentPolicy": {"filters": [{"type": "MISCONDUCT", "action": "BLOCKED"}]},
            "topicPolicy": {"topics": [{"name": "GUARANTEE", "action": "BLOCKED"}]},
        }],
    })
    _use_fake(monkeypatch, fake)
    monkeypatch.setattr(c.router, "converse", lambda *a, **k: "정정된 안내입니다")

    log, _ = c.review_loop("무조건 됩니다", {"stage": Stage.PROPOSE})
    reviewing = next(s for s in log if s["state"] == "reviewing")
    assert reviewing["violated_policies"], "reviewing 단계에 위반 목록이 비어있으면 안 됨"
    assert "MISCONDUCT" in reviewing["violated_policies"]
    assert "GUARANTEE" in reviewing["violated_policies"]


def test_approved_step_carries_original_and_final_after_redraft(monkeypatch):
    """재작성 후 approved 단계가 원문(draft)+최종문(final_text)을 함께 싣는다 (Acceptance #3, FRONTEND diff)."""
    monkeypatch.setattr(c, "_GUARDRAIL_ID", "gr-123")
    seq = [
        {"action": "GUARDRAIL_INTERVENED", "assessments": [
            {"contentPolicy": {"filters": [{"type": "MISCONDUCT", "action": "BLOCKED"}]}}]},
        {"action": "NONE", "assessments": []},
    ]

    class _Seq(_FakeBedrock):
        def apply_guardrail(self, **kwargs):
            self.calls.append(kwargs)
            return seq[len(self.calls) - 1]

    fake = _Seq()
    _use_fake(monkeypatch, fake)
    monkeypatch.setattr(c.router, "converse", lambda *a, **k: "정정된 안내입니다")

    log, final = c.review_loop("무조건 됩니다", {"stage": Stage.PROPOSE})
    approved = log[-1]
    assert approved["state"] == "approved"
    assert approved["draft"] == "무조건 됩니다"      # 원문 보존
    assert approved["final_text"] == "정정된 안내입니다"  # 최종 확정문
    assert final == approved["final_text"]


def test_approved_final_text_present_on_clean_first_pass(monkeypatch):
    """첫 검수에 통과해도 approved 단계엔 final_text가 채워진다(원문==최종)."""
    monkeypatch.setattr(c, "_GUARDRAIL_ID", "gr-123")
    fake = _FakeBedrock({"action": "NONE", "assessments": []})
    _use_fake(monkeypatch, fake)

    log, final = c.review_loop("상담원 연결해 드리겠습니다", {"stage": Stage.PROPOSE})
    approved = log[-1]
    assert approved["state"] == "approved"
    assert approved["draft"] == "상담원 연결해 드리겠습니다"
    assert approved["final_text"] == final
