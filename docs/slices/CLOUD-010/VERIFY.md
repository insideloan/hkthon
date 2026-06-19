# Verify Checklist — `CLOUD-010` (#52)

> IAM 과다권한 감사 + CloudWatch 알람/대시보드 보강. 생성은 #54.

## 수용 기준 (#52) — 2026-06-19 실측

- [x] IAM 역할별 최소권한 확인 + 과다권한(`*:*`) 없음
  - orchestrator role 감사: DynamoDB/S3/Secrets는 CDK가 특정 ARN으로 스코프(양호).
  - 직접 작성했던 Bedrock `*` → **foundation-model + inference-profile ARN**으로 축소, ApplyGuardrail → **guardrail ARN**.
  - Transcribe streaming은 `Resource=*` 유지 — **AWS가 리소스 레벨 권한 미지원**(의도된 것, 주석 명시).
  - `*:*`(action+resource 모두 와일드카드) 없음 확인.
- [x] Lambda/AppSync 로그가 CloudWatch에 수집됨 — fresh invoke 후 `invoke field=createCall` 로그 실시간 확인 (LogGroup `HkthonStack-OrchestratorLogs…`)
- [x] 기본 알람/대시보드 1개 이상 — 알람 2개(`hkthon-orchestrator-errors`, `hkthon-appsync-5xx`) + 대시보드 `hkthon`

## 감사 요약

| Resource | 권한 | 판정 |
|---|---|---|
| DynamoDB | 테이블 ARN 한정 | ✅ 최소 |
| S3 | 버킷 ARN 한정 | ✅ 최소 |
| Secrets Manager | 시크릿 ARN 한정 | ✅ 최소 |
| Bedrock InvokeModel | foundation-model + inference-profile ARN | ✅ 축소됨(was `*`) |
| Bedrock ApplyGuardrail | guardrail ARN | ✅ 축소됨(was `*`) |
| Transcribe streaming | `*` | ⚠️ AWS 제약(리소스 레벨 미지원), 의도됨 |

## 결과
- [x] **PASS**
