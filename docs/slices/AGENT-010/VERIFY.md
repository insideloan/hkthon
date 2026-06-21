# Verify Checklist — `AGENT-010` (컴플라이언스 Guardrails 실호출)

> **`hk-verify` skill이 채웁니다. 비개발자가 코드 없이 한 줄씩 체크.**
> 이 PR 범위는 Bedrock Guardrails **실호출 경로**(mock 단위 테스트). DynamoDB write(ComplianceReview)는 의존성 DATA-005(models) 완료 후 후속 PR.

관련 issue: **#18** · 변경 파일: `lambda/orchestrator/agent/compliance.py`, `lambda/orchestrator/tests/test_compliance_loop.py`, `docs/slices/AGENT-010/VERIFY.md`

---

## A. 자동 검증 / Auto Verify

- [ ] **단위 테스트 통과**
  ```bash
  cd lambda && python -m pytest orchestrator/tests/ -q
  # 기대: all passed (1 skipped = langgraph 라이브 의존)
  ```
- [ ] **lint 0 errors**
  ```bash
  ruff check lambda/orchestrator/agent/compliance.py
  ```

---

## B. 수용 기준 (Issue #18 §Acceptance) / Acceptance Criteria

- [ ] **위반 시 재작성 경로** — Bedrock 1회 차단 → redact/redraft → 통과
  ```bash
  cd lambda && python -m pytest orchestrator/tests/test_compliance_loop.py -q -k "redraft"
  ```
- [ ] **최대 재시도 후 종료** — 계속 차단 시 안전 fallback로 approved 종료
  ```bash
  cd lambda && python -m pytest orchestrator/tests/test_compliance_loop.py -q -k "exhausts"
  ```
- [ ] **`approved` 시 최종 상태 이벤트** — log 마지막 state == approved
  ```bash
  cd lambda && python -m pytest orchestrator/tests/test_compliance_loop.py -q -k "loop"
  ```
- [ ] **DynamoDB write 호출 검증 (mock boto3)** — ⏸ DATA-005(models) 완료 후 후속 PR로 이관

---

## E. LLM / Guardrails (해당 시)

- [ ] **Guardrail ID 설정 시 Bedrock 실호출** — `apply_guardrail(source=OUTPUT)` 경로
  ```bash
  cd lambda && python -m pytest orchestrator/tests/test_compliance_loop.py -q -k "bedrock or apply"
  ```
- [ ] **Guardrail ID 미설정/오류 시 룰 폴백** — 데모 안정성(통화 안 끊김)
  ```bash
  cd lambda && python -m pytest orchestrator/tests/test_compliance_loop.py -q -k "fall"
  ```

---

## G. 데모 가능성 / Demo-readiness

- [ ] 작성→검수→삭제→재작성→승인 상태 시퀀스가 CompliancePanel에 표시 가능
- [ ] 라이브 모드(Guardrail ID 설정) 시 실제 Bedrock Guardrails 검수, 미설정 시 룰 검수로 동일 UX
