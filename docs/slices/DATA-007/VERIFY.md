# Verify Checklist — `DATA-007` (시드 데이터 — 데모 고객 10명)

> **`hk-verify` skill이 채웁니다. 비개발자가 코드 없이 한 줄씩 체크.**
> 이 issue는 boto3 시드 스크립트 + 멱등성 단위 테스트라 관련 섹션만 남김.
> 선행 의존: **DATA-001(#1, Customer 모델)** — 같은 세션에서 PR #116으로 함께 구현.

관련 issue: **#7** · 변경 파일: `lambda/orchestrator/seed.py`, `lambda/orchestrator/tests/test_seed.py`, `docs/slices/DATA-007/VERIFY.md`

---

## A. 자동 검증 / Auto Verify

> Claude가 자동 실행. 결과만 확인하세요.

- [ ] **단위 테스트 통과** — 시드 + Customer 모델 포함 전체 green
  ```bash
  cd lambda && python -m pytest orchestrator/tests/ -q
  # 기대: all passed (1 skipped = langgraph 라이브 의존)
  ```
- [ ] **lint 0 errors**
  ```bash
  ruff check lambda/orchestrator/seed.py lambda/orchestrator/models/
  # 기대: All checks passed!
  ```

---

## B. 수용 기준 (Issue #7 §Acceptance) / Acceptance Criteria

- [ ] **seed 실행 후 DynamoDB 고객 10명**
  ```bash
  cd lambda && python -m pytest orchestrator/tests/test_seed.py -q -k "ten_customers"
  # test_seed_inserts_ten_customers: inserted==10, count==10
  ```
- [ ] **박서준 KCB744·차량보유 페르소나 검증**
  ```bash
  cd lambda && python -m pytest orchestrator/tests/test_seed.py -q -k "park_seojun"
  # 박서준 존재, credit_score==744, has_vehicle==True, scenario_hint=="S1"
  ```
- [ ] **재실행해도 중복 없음 (conditional put 멱등성)**
  ```bash
  cd lambda && python -m pytest orchestrator/tests/test_seed.py -q -k "idempotent"
  # 2회차 inserted==0, count 유지, 기존 아이템 비덮어쓰기
  ```

---

## C. 비고 / Notes

- `put_item(ConditionExpression="attribute_not_exists(PK)")` 로 멱등 conditional put.
  이미 존재하는 PK는 `ConditionalCheckFailedException` → skip (덮어쓰지 않음).
- 각 고객은 META 아이템 + 목록 인덱스 아이템(`CUSTOMERS`/`CUST#`) 두 건 저장.
- `credit_score=744` = KCB(한국 신용평가사) 744점 해석.
- 라이브 DynamoDB 시드는 `TABLE_NAME` env 설정 후 `python -m orchestrator.seed`.
