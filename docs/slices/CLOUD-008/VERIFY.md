# Verify Checklist — `CLOUD-008` (#50)

> Lambda orchestrator 배포 (스크립트 모드) — **placeholder bundle** connect/verify.
> 실제 orchestrator 코드는 AGENT/BACKEND `lambda/orchestrator/`가 교체.

## A. 자동 검증

- [x] `cdk deploy` UPDATE_COMPLETE — Lambda 코드 갱신됨
- [x] placeholder bundle = `infra/lambda-placeholder/handler.py` (asset)

## B. 수용 기준 (#50)

- [x] 배포된 Lambda가 최신 코드 번들로 갱신됨 (asset 해시 변경 → deploy diff `[~] Function`)
- [x] 스크립트 모드: `nextTurn` → DynamoDB turn row 생성 → `TURN#0000`/`TURN#0001` 확인
- [x] 시크릿이 코드에 하드코딩 안 됨 — handler는 TABLE_NAME(env)만 사용, Typecast는 Secrets Manager ARN
- [x] CloudWatch 로그에 실행 기록 → `invoke field=createCall/nextTurn` 로그 확인 (LogGroup `HkthonStack-OrchestratorLogs…`)

## C. 범위 메모

- placeholder handler는 createCall→`CALL#{id}/META`, nextTurn→`CALL#{id}/TURN#{seq}` (고정 스크립트 3턴 cycling) write만.
- 실제 LangGraph/LLM/STT/TTS 로직은 AGENT `lambda/orchestrator/`가 이 자리를 교체 (#50 실작업).
- Bedrock/Transcribe IAM·Guardrail은 이미 스택에 존재 (라이브 모드 대비).

## 결과

- [x] **PASS** (placeholder 수준) — script-mode write 경로 실증, 로그 확인.
