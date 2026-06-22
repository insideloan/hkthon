# Verify Checklist — `DATA-002~006` (DynamoDB 도메인 모델 5종)

> **`hk-verify` skill이 채웁니다. 비개발자가 코드 없이 한 줄씩 체크.**
> 5개 독립 이슈(#2~#6)를 같은 `models/` 패턴으로 한 브랜치/PR에 묶음. 전부 단위 테스트.

관련 issue: **#2 #3 #4 #5 #6** · 변경 파일: `lambda/orchestrator/models/{call,turn,mot,compliance,summary,product,scenario_run}.py`, `lambda/orchestrator/tests/test_{call_state,turn_model,mot_model,compliance_model,misc_models}.py`, `docs/slices/DATA-002-006/VERIFY.md`

---

## A. 자동 검증 / Auto Verify

- [ ] **단위 테스트 통과** — 전체 green
  ```bash
  cd lambda && python -m pytest orchestrator/tests/ -q
  # 기대: 254 passed, 1 skipped (langgraph 라이브 의존)
  ```
- [ ] **lint 0 errors** (ruff는 /workshop 루트에서 실행)
  ```bash
  cd /workshop && ruff check lambda/orchestrator/models/
  # 기대: All checks passed!
  ```

---

## B. 수용 기준 / Acceptance (이슈별)

- [ ] **#2 Call** — CallState 8값, DIALING→RINGING 허용·ENDED→IN_CALL 거부, round-trip, scenario 기본 S1
  `pytest orchestrator/tests/test_call_state.py`
- [ ] **#3 Turn** — speaker enum, tokens Map round-trip(polarity/reason), polarity null 허용, flag risk/def/null
  `pytest orchestrator/tests/test_turn_model.py`
- [ ] **#4 MOT** — marker_id/state/crm_stage enum, round-trip, 폐기필드 제거, mots resolver 호환
  `pytest orchestrator/tests/test_mot_model.py`
- [ ] **#5 ComplianceReview** — state 5단계 + 전이순서, violated_policies 리스트, SK CMPL#{turn}#{try}, draft/violated/final
  `pytest orchestrator/tests/test_compliance_model.py`
- [ ] **#6 Summary·Product·ScenarioRun** — ResultType enum, 3모델 마샬링, crm_stages 4단계 List of Maps + mots
  `pytest orchestrator/tests/test_misc_models.py`

---

## C. 비고 / BACKEND 합의 필요 (wire 매핑)

- **#2 CallState 불일치**: DATA 도메인 상태머신 8값(RINGING/ON_HOLD/TRANSFERRING/IN_AGENT/WRAP_UP 포함) vs GraphQL `CallState` 5값(CREATED/DIALING/IN_CALL/TRANSFER_PENDING/ENDED). 도메인 전이 가드용으로 8값 유지 — wire 직렬화 매핑은 BACKEND #28 합의 필요.
- **#4 MOT**: 모델은 SSOT-3 도메인값(rz-*/소문자/한글) 입력받아 **검증**하되 `to_item()`은 wire-canonical(MOT_n/대문자/영문 enum)로 마샬 → 기존 `mots resolver` 무수정 호환(테스트로 보장).
- **#3 Turn `flag`**: "risk"|"def"|null → wire `SpeechAnalysis.turnFlag` RISK|DEF|NEUTRAL(null→NEUTRAL).
- GraphQL 스키마(BACKEND 소유)는 본 PR에서 미변경.
