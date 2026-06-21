# Verify Checklist — `AGENT-011` (발화 분석: 키워드 polarity+reason)

> **`hk-verify` skill이 채웁니다. 비개발자가 코드 없이 한 줄씩 체크.**
> 이 issue는 순수 로직(렉시콘 기반 토큰화) 단위 테스트라 관련 섹션만 남김.

관련 issue: **#19** · 변경 파일: `lambda/orchestrator/agent/analysis.py`, `lambda/orchestrator/agent/state.py`, `lambda/orchestrator/tests/test_speech_analysis.py`, `docs/slices/AGENT-011/VERIFY.md`

---

## A. 자동 검증 / Auto Verify

- [ ] **단위 테스트 통과**
  ```bash
  cd lambda && python -m pytest orchestrator/tests/ -q
  # 기대: all passed (1 skipped = langgraph 라이브 의존)
  ```
- [ ] **lint 0 errors**
  ```bash
  ruff check lambda/orchestrator/agent/analysis.py lambda/orchestrator/agent/state.py
  # 기대: All checks passed!
  ```

---

## B. 수용 기준 (Issue #19 §Acceptance) / Acceptance Criteria

- [ ] **PRO/CONS 분류 테스트 통과** — 거절 키워드=CONS, 성공경로 키워드=PRO
  ```bash
  cd lambda && python -m pytest orchestrator/tests/test_speech_analysis.py -q -k "classified or polarity"
  ```
- [ ] **`reason`이 매칭 카테고리를 반영** — 렉시콘 카테고리 desc가 reason에 담김
  ```bash
  cd lambda && python -m pytest orchestrator/tests/test_speech_analysis.py -q -k "reason"
  ```
- [ ] **비키워드 토큰 `polarity=null`** — 중립 어절은 None
  ```bash
  cd lambda && python -m pytest orchestrator/tests/test_speech_analysis.py -q -k "non_keyword"
  ```

---

## G. 데모 가능성 / Demo-readiness

- [ ] 고객 발화의 초록(PRO)/빨강(CONS) 키워드가 어절 단위로 구분되어 SpeechAnalysis 카드에 표시 가능
- [ ] 부정어 반전("안 끊을게요" → PRO)이 churn_risk와 동일 규칙으로 일관 동작
- [ ] 렉시콘 SSOT 일원화 — 사전/매칭 규칙이 churn_risk 한 곳에만 존재
