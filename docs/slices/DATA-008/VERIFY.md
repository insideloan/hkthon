# Verify Checklist — `DATA-008` (#8) S1 시나리오 + S3 로더

> **`hk-verify` skill이 채웁니다. 비개발자가 코드 없이 한 줄씩 체크.**
> SSOT-3(`docs/consult_redesigned-3.html` const S) 18턴을 S3용 JSON으로 직렬화 + 스키마 검증 로더.

관련 issue: **#8** · 변경 파일: `data/scenarios/s1.json`, `lambda/orchestrator/models/scenario_loader.py`, `lambda/orchestrator/tests/test_scenario_loader.py`, `docs/slices/DATA-008/VERIFY.md`

---

## A. 자동 검증 / Auto Verify

- [ ] **단위 테스트 통과**
  ```bash
  cd lambda && python -m pytest orchestrator/tests/test_scenario_loader.py -q
  # 기대: 15 passed
  ```
- [ ] **전체 스위트 회귀 없음**
  ```bash
  cd lambda && python -m pytest orchestrator/tests/ -q
  # 기대: 272 passed, 1 skipped
  ```
- [ ] **s1.json 유효 JSON · 18턴**
  ```bash
  python3 -c "import json; print(len(json.load(open('data/scenarios/s1.json'))['turns']))"  # 18
  ```
- [ ] **lint 0 errors** (ruff는 /workshop 루트에서)
  ```bash
  cd /workshop && ruff check lambda/orchestrator/models/scenario_loader.py
  ```

---

## B. 수용 기준 (Issue #8 §Acceptance)

- [ ] **s1.json 18턴 로드 성공** — `test_s1_loads_18_turns`
- [ ] **스키마 검증이 누락 필드 탐지(flag/mot/compliance)** — `test_missing_required_field_detected` / `test_invalid_mot_marker_detected` / `test_invalid_compliance_state_detected`
- [ ] **cust/ai 교대 순서 검증** — `test_customer_turns_not_consecutive` / `test_consecutive_customer_turns_detected`
- [ ] **scenario_loader가 S3 GetObject(boto3)로 로드** — `test_load_from_s3_getobject`
- [ ] **각 턴 flag ∈ {risk,def,null}** — `test_s1_flag_values_valid`
- [ ] **MOT marker_id ∈ 5종, state ∈ {show,alert,blocked}** — `test_s1_has_five_mot_markers`
- [ ] **compliance.state 5단계 enum + violated_policies 리스트** — `test_s1_compliance_states_valid`
- [ ] **strategy_headline/strategy_lead 존재** — `test_s1_strategy_fields_present`

---

## C. 비고 / 데이터 출처

- 원천: `docs/consult_redesigned-3.html` `const S`(18턴). `who:ai/cust`→speaker, `kw`(문자열/`{w,r|g}`)→tokens(r=CONS, g=PRO, 그외 null), `prob`→churn_after, `bann.type`→flag, `risk/def.rz`→mot.marker_id, `cp`/`def.tac`→strategy.
- MOT 5종(rz-rate/compare/pay/security/avoid) 전부 등장, crm_stage 매핑은 `agent/mot.py`와 일치(rate·compare=신뢰 쌓기, pay=우려 풀기, security=담보 오해, avoid=전환 맺기).
- token `polarity`는 키워드 색상용 아님 → 턴 레벨 `flag` 분기 신호(`_notes`에 명시).
- S3 키는 `Settings.scenario_key`(api/config.py, 기본 `scenarios/scenario.json`) 사용 — 로더는 bucket/key 주입식.
