"""AGENT-010 (#18) — Bedrock Guardrails 실호출 경로 + ComplianceReview persist 검증.

Guardrails 실호출 파싱 + 룰 폴백 + 루프 재작성 경로 + DynamoDB write(ComplianceReview)
검증. DATA-005 models.compliance 완료로 persist 경로가 unblock됨.
"""

import pytest

from orchestrator.agent import compliance as c
from orchestrator.agent.state import Stage
from orchestrator.api import dynamo

from ._fake_dynamo import FakeTable


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


def test_guardrail_pii_name_is_exempt_but_real_pii_blocks(monkeypatch):
    """PII NAME(고객 이름 호명)은 위반에서 제외 — 인사/본인확인 멘트가 redraft 소진→fallback
    되던 버그(live seq2 '정확한 내용은 상담원이…') 회귀 방지. 단 KR_RRN 등 진짜 PII는 유지."""
    fake = _FakeBedrock({
        "action": "GUARDRAIL_INTERVENED",
        "assessments": [{
            "sensitiveInformationPolicy": {"piiEntities": [
                {"type": "NAME", "action": "ANONYMIZED"},
                {"type": "KR_RRN", "action": "ANONYMIZED"},
            ]},
        }],
    })
    _use_fake(monkeypatch, fake)
    v = c._bedrock_guardrails("안녕하세요 박서준님, 현대캐피탈입니다.")
    assert "NAME" not in v["violated"]   # 이름 호명은 면제
    assert "KR_RRN" in v["violated"]      # 주민번호 등 진짜 PII는 차단 유지


def test_guardrail_only_name_pii_is_not_blocked(monkeypatch):
    """위반이 PII NAME 하나뿐이면 blocked=False — 인사 멘트가 통과해야 한다."""
    fake = _FakeBedrock({
        "action": "GUARDRAIL_INTERVENED",
        "assessments": [{
            "sensitiveInformationPolicy": {"piiEntities": [{"type": "NAME", "action": "ANONYMIZED"}]},
        }],
    })
    _use_fake(monkeypatch, fake)
    v = c._bedrock_guardrails("안녕하세요 박서준님, 현대캐피탈입니다.")
    assert v["violated"] == []
    assert v["blocked"] is False


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


# ─────────────────────────────────────────────────────────────────────────────
# persist_compliance_log — ComplianceReview DynamoDB write (Acceptance #5)
# ─────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def _fake_table():
    dynamo.set_table(FakeTable())
    yield
    dynamo.set_table(None)


def _redraft_log(monkeypatch):
    """위반 1회→재작성→통과 로그 생성 (drafting..approved 전 단계 포함)."""
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
    log, _ = c.review_loop("무조건 됩니다", {"stage": Stage.PROPOSE})
    return log


def test_persist_writes_one_item_per_step(monkeypatch, _fake_table):
    log = _redraft_log(monkeypatch)
    written = c.persist_compliance_log("call-1", 3, log)
    # 단계별 1행 — 로그 step 수와 동일
    assert len(written) == len(log)
    # 모든 아이템이 같은 통화 PK, SK는 CMPL#{turn}#{try}#{state}
    for item in written:
        assert item["PK"] == dynamo.pk_call("call-1")
        assert item["SK"].startswith("CMPL#3#")
    # 단계 전이가 SK 충돌 없이 모두 보존됐는지
    stored = dynamo.query(dynamo.pk_call("call-1"), dynamo.SK_PREFIX_CMPL)
    states = {i["state"] for i in stored}
    assert {"drafting", "reviewing", "redacting", "redrafting", "approved"} <= states
    assert len(stored) == len(log)


def test_persist_reviewing_carries_violated_policies(monkeypatch, _fake_table):
    log = _redraft_log(monkeypatch)
    c.persist_compliance_log("call-1", 3, log)
    stored = dynamo.query(dynamo.pk_call("call-1"), dynamo.SK_PREFIX_CMPL)
    reviewing = [i for i in stored if i["state"] == "reviewing"]
    assert reviewing
    assert any("MISCONDUCT" in (i.get("violated_policies") or []) for i in reviewing)


def test_persist_approved_has_final_for_fanout(monkeypatch, _fake_table):
    """팬아웃(_compliance_payload)이 finalDiff로 읽는 final_text가 approved에 실린다."""
    log = _redraft_log(monkeypatch)
    c.persist_compliance_log("call-1", 3, log)
    stored = dynamo.query(dynamo.pk_call("call-1"), dynamo.SK_PREFIX_CMPL)
    approved = next(i for i in stored if i["state"] == "approved")
    assert approved["final_text"] == "정정된 안내입니다"
    assert approved["final"] == "정정된 안내입니다"  # 모델 필드도 동일
    assert approved["draft"] == "무조건 됩니다"       # 원문 보존


# ─────────────────────────────────────────────────────────────────────────────
# fused confidence 게이트 — 고신뢰 + 룰 클린이면 Bedrock 왕복 생략
# ─────────────────────────────────────────────────────────────────────────────


def test_confidence_gate_skips_bedrock_when_high_and_rule_clean(monkeypatch):
    """신뢰도 >= 임계값이고 룰 검수가 깨끗하면 Bedrock apply_guardrail을 호출하지 않는다."""
    fake = _FakeBedrock(response={"action": "NONE", "assessments": []})
    _use_fake(monkeypatch, fake)
    monkeypatch.setattr(c, "_GUARDRAIL_ID", "gr-123")
    monkeypatch.setattr(c, "_COMPLIANCE_CONF_THRESHOLD", 0.8)

    log, final = c.review_loop("안녕하세요, 무엇을 도와드릴까요?", {"_compliance_confidence": 0.95})
    assert final == "안녕하세요, 무엇을 도와드릴까요?"
    assert fake.calls == []   # Bedrock 미호출(네트워크 왕복 생략)


def test_confidence_gate_runs_bedrock_when_low(monkeypatch):
    """신뢰도 < 임계값이면 기존대로 Bedrock을 호출한다."""
    fake = _FakeBedrock(response={"action": "NONE", "assessments": []})
    _use_fake(monkeypatch, fake)
    monkeypatch.setattr(c, "_GUARDRAIL_ID", "gr-123")
    monkeypatch.setattr(c, "_COMPLIANCE_CONF_THRESHOLD", 0.8)

    c.review_loop("응답 문장", {"_compliance_confidence": 0.4})
    assert len(fake.calls) >= 1   # 저신뢰 → Bedrock 검수 수행


def test_apply_guardrails_skip_bedrock_still_runs_rule(monkeypatch):
    """skip_bedrock=True여도 결정적 룰 검수는 수행되어 위반을 잡는다(자가평가가 룰을 약화 못 함)."""
    fake = _FakeBedrock(response={"action": "NONE", "assessments": []})
    _use_fake(monkeypatch, fake)
    monkeypatch.setattr(c, "_GUARDRAIL_ID", "gr-123")

    # 룰 패턴(_POLICY_PATTERNS)에 걸리는 단정 표현 — Bedrock 생략해도 룰이 blocked로 잡아야 함.
    verdict = c._apply_guardrails("무조건 됩니다 고객님", skip_bedrock=True)
    assert verdict["blocked"] is True       # 룰이 위반 포착
    assert fake.calls == []                 # Bedrock 왕복은 생략됨

    # 깨끗한 텍스트는 skip_bedrock에서 통과(approved)
    clean = c._apply_guardrails("심사 결과에 따라 안내해 드리겠습니다.", skip_bedrock=True)
    assert clean["blocked"] is False
    assert fake.calls == []


def test_no_confidence_runs_bedrock_as_before(monkeypatch):
    """신뢰도 미설정(비-fused 경로)이면 기존 동작 그대로 Bedrock 호출."""
    fake = _FakeBedrock(response={"action": "NONE", "assessments": []})
    _use_fake(monkeypatch, fake)
    monkeypatch.setattr(c, "_GUARDRAIL_ID", "gr-123")

    c.review_loop("응답", {})   # _compliance_confidence 없음
    assert len(fake.calls) >= 1
