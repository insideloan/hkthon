# Verify Checklist — `CLOUD-011`

> 전체 AWS 리소스 프로비저닝 (CDK 단일 스택) + bootstrap. Issue #54.

---

## A. 코드/자동 검증 / Code & Auto Verify

> Claude가 자동 실행. 결과만 확인하세요. (node는 nvm, 아래 명령 앞에 `cd infra`.)

- [x] `npm install` (infra/) — 성공, 0 vulnerabilities
- [x] `npx cdk synth` — exit 0, 경고 없음
- [x] 합성 템플릿(`cdk.out/HkthonStack.template.json`)에 리소스 존재 확인:
  - DynamoDB Table(+Stream), S3 Bucket, SecretsManager Secret, Lambda Function, AppSync GraphQLApi + 2 DataSource, IAM Role/Policy, Logs LogGroup
- [x] CfnOutput 5종: `AppSyncUrl` / `AppSyncApiKey` / `TableName` / `AssetsBucketName` / `OrchestratorName`

---

## B. 수용 기준 (Issue #54 §Acceptance) / Acceptance Criteria

- [x] `cd infra && npm install && cdk synth` 0 error
- [ ] `cdk bootstrap` 완료 (CDKToolkit 스택 생성 확인) — **승인 후 실행 예정** (공유 계정 변경)
- [ ] `cdk deploy` 성공 + 리소스 생성 확인 — **bootstrap 후, 승인 시 실행**
- [x] CfnOutput으로 AppSync URL/key, 테이블·버킷명 노출 (synth 템플릿 Outputs 확인)
- [x] deploy 순서 문서화됨 (`infra/README.md`)

> **참고**: `cdk synth`는 로컬(AWS 호출 없음)이라 완료. `bootstrap`/`deploy`는 계정 758193219211을 실제로 변경하므로 사용자 승인 후 실행. 그 두 항목은 deploy 단계에서 체크.

---

## C. Deploy 검증 (bootstrap/deploy 실행 후) / Post-deploy

- [ ] `aws cloudformation describe-stacks --stack-name CDKToolkit` — bootstrap 확인
- [ ] `aws cloudformation describe-stacks --stack-name HkthonStack` — CREATE_COMPLETE
- [ ] `aws dynamodb describe-table` — 테이블 + StreamSpecification ENABLED
- [ ] `aws s3 ls` — 버킷 존재
- [ ] AppSync introspection 200 (`curl $AppSyncUrl -H "x-api-key: ..."`)

---

## D. 시크릿 위생 / Secret Hygiene

- [x] `TYPECAST_API_KEY` 평문이 코드/커밋에 없음 — Secrets Manager 참조(ARN)만 env로 전달
- [x] account id 하드코딩 없음 — `CDK_DEFAULT_ACCOUNT`에서 해석

---

## E. 범위 메모 / Scope Notes

- Lambda 핸들러 + GraphQL 스키마는 **placeholder** (synth 통과용). 실제 코드/스키마는 #50/#49에서 교체.
- Amplify Hosting 앱 + Bedrock Guardrail 리소스는 이 issue의 **후속 커밋**에서 추가 (GitHub 연결 토큰/guardrail 정책 필요).

---

## 결과 / Result

- [ ] **PASS** — synth 기준 통과. bootstrap/deploy는 승인 후 별도 체크.
- [ ] **FAIL** — 실패 항목 있음

```
NOTE: synth 단계 완료. bootstrap/deploy는 공유 AWS 계정 변경이라 사용자 승인 대기 중.
```
