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
- [x] `cdk bootstrap` 완료 (CDKToolkit = CREATE_COMPLETE, 12/12 리소스)
- [x] `cdk deploy` 성공 (HkthonStack = CREATE_COMPLETE, 27/27 리소스, 66s)
- [x] CfnOutput으로 AppSync URL/key, 테이블·버킷명 노출 (deploy Outputs 확인)
- [x] deploy 순서 문서화됨 (`infra/README.md`)

---

## C. Deploy 검증 (bootstrap/deploy 실행 후) / Post-deploy

- [x] `describe-stacks CDKToolkit` → CREATE_COMPLETE
- [x] `describe-stacks HkthonStack` → CREATE_COMPLETE
- [x] DynamoDB → `ACTIVE`, Stream `StreamEnabled=true`, `NEW_AND_OLD_IMAGES`
- [x] S3 버킷 존재 (비어있음)
- [x] AppSync introspection 200 → `{"data":{"__typename":"Query"}}`
- [x] Lambda orchestrator → `python3.13`, state `Active`

### 배포 산출물 (CfnOutput) — 후속 issue/`.env.local`(#55)용
> ⚠️ **AppSync URL/API key는 크레덴셜이라 레포에 커밋 금지.** 실제 값은
> `cd infra && npx cdk deploy` 출력 또는
> `aws cloudformation describe-stacks --stack-name HkthonStack --query 'Stacks[0].Outputs'`
> 에서 확인. `.env.local` 배포는 #55(CLOUD-012)에서 안전 채널로 처리.

- `AppSyncUrl` = `<deploy 출력 참조>` (`...appsync-api.ap-northeast-2.amazonaws.com/graphql`)
- `AppSyncApiKey` = `<deploy 출력 참조 — 평문 커밋 금지, 30일 만료>`
- `TableName` = `HkthonStack-CallTable…` (deploy 출력)
- `AssetsBucketName` = `hkthonstack-assetsbucket…` (deploy 출력)
- `OrchestratorName` = `HkthonStack-Orchestrator…` (deploy 출력)

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

- [x] **PASS** — synth + bootstrap + deploy 전부 성공, 모든 리소스 실측 검증 완료.

```
NOTE: 계정 758193219211 / ap-northeast-2에 실제 배포됨. AppSync API_KEY는 30일 만료.
AWS creds(인스턴스 역할)에 CloudFormation/IAM/SSM/AppSync/Lambda 권한이 추가되어 deploy 가능했음.
```
