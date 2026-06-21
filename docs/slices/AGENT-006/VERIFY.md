# Verify Checklist — `AGENT-006` (transfer/fraud 노드)

> **`hk-verify` skill이 채웁니다. 비개발자가 코드 없이 한 줄씩 체크.**
> 이 issue는 LangGraph 노드 단위 로직(라이브 모드 전 단위 테스트)이라 관련 섹션만 남김.

관련 issue: **#14** · 변경 파일: `lambda/orchestrator/agent/state.py`, `lambda/orchestrator/agent/nodes.py`, `lambda/orchestrator/agent/graph.py`, `lambda/orchestrator/tests/test_transfer_fraud.py`, `docs/slices/AGENT-006/VERIFY.md`

---

## A. 자동 검증 / Auto Verify

> Claude가 자동 실행. 결과만 확인하세요.

- [ ] **단위 테스트 통과** — transfer/fraud 포함 전체 green
  ```bash
  cd lambda && python -m pytest orchestrator/tests/ -q
  # 기대: all passed (1 skipped = langgraph 라이브 의존)
  ```
- [ ] **lint 0 errors**
  ```bash
  ruff check lambda/orchestrator/agent/ lambda/orchestrator/llm/
  # 기대: All checks passed!
  ```
- [ ] **graph 문법 유효** — detect_fraud 노드 삽입 후 graph.py 파싱
  ```bash
  python3 -c "import ast; ast.parse(open('lambda/orchestrator/agent/graph.py').read()); print('OK')"
  ```

---

## B. 수용 기준 (Issue #14 §Acceptance) / Acceptance Criteria

- [ ] **transfer 시 상태 전이 검증** — `transfer_node` → `call_status == TRANSFER_PENDING`
  ```bash
  cd lambda && python -m pytest orchestrator/tests/test_transfer_fraud.py -q -k "transfer"
  # test_transfer_sets_transfer_pending / test_transfer_is_not_ended
  ```
- [ ] **fraud 플래그가 통화를 종료하지 않음 검증** — `detect_fraud`는 `fraud_suspected`만 세팅, route/stage/call_status 미변경
  ```bash
  cd lambda && python -m pytest orchestrator/tests/test_transfer_fraud.py -q -k "fraud"
  # test_fraud_flag_does_not_change_route_or_stage 등 5케이스
  ```

---

## G. 데모 가능성 / Demo-readiness

- [ ] 상담원 연결 요청 시 통화가 `TRANSFER_PENDING`으로 전이되어 대시보드에 "이관 대기" 표시 가능
- [ ] 보이스피싱 의심 발화 시 `fraud_suspected` 플래그가 켜지되 통화는 계속 — 대시보드 경고 배지 노출용
- [ ] 두 동작 모두 다른 노드(classify/churn/respond) 흐름과 충돌 없음
