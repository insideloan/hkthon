# Verify Checklist — `CLOUD-009` (#51)

> Bedrock 모델 *계정* 액세스 + Guardrail 차단 검증. Guardrail/IAM 리소스 생성은 #54/#52.

## 수용 기준 (#51) — 2026-06-19 실측

- [x] Bedrock 모델 액세스 활성 (`ap-northeast-2`)
  - `global.anthropic.claude-sonnet-4-6` Converse 호출 성공 → `"안녕!"` 응답.
  - 이 워크숍 계정은 Anthropic 모델 액세스가 **이미 부여**돼 있어 콘솔 enable 불필요.
- [x] #54가 만든 Guardrail로 차단 케이스 동작
  - 유해 입력 → `action: GUARDRAIL_INTERVENED` (차단)
  - 정상 상담 입력 → `action: NONE` (통과) — 판별력 확인
- [x] Lambda 실행 역할에 `bedrock:InvokeModel` 최소권한
  - #52에서 foundation-model + inference-profile ARN으로 스코프. simulate → `allowed`.
- [x] AWS 자격증명 코드 하드코딩 없음 — Lambda env엔 모델 id(`LLM_MODEL`)만, 호출은 IAM 역할로.

## 범위 메모

- 모델 *계정* 액세스는 CDK로 불가(계정 레벨) — 본 issue는 검증 담당. 이번 계정은 사전 부여 상태였음.
- Guardrail 리소스 자체 + Lambda IAM은 #54/#52에서 이미 배포·축소됨.
- 라이브 모드 컴플라이언스 루프(draft→guardrail→재작성)의 실제 호출 코드는 AGENT `lambda/orchestrator/` (#50 실작업).

## 결과
- [x] **PASS**
