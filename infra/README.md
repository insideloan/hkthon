# infra — AWS CDK (CLOUD-011 / #54)

Single serverless CDK stack for the AI 상담 코파일럿 booth demo.
Owner: **CLOUD (solduma)**. Region: **ap-northeast-2**.

## Prerequisites

- Node 20+, AWS CDK CLI (`npm i -g aws-cdk`), AWS credentials (`aws sts get-caller-identity`).
- See `hk-skills/skills/hk-onboard` for the full toolchain.

## Commands

```bash
cd infra
npm install
npx cdk synth         # local — emits CloudFormation, no AWS calls
npx cdk bootstrap     # one-time per account/region (creates CDKToolkit stack)
npx cdk deploy        # provisions the stack
```

## Deploy order

1. **`cdk bootstrap`** — one-time, creates the CDKToolkit stack (S3/IAM/ECR) in `ap-northeast-2`.
2. **`cdk deploy`** — provisions DynamoDB(+Streams), S3, Secrets Manager, Lambda orchestrator (placeholder), AppSync (placeholder schema), IAM, CloudWatch logs.
3. **Bedrock model access (#51 / CLOUD-009)** — request account-level model access in the console/CLI (not possible via CDK).
4. **Apply schema (#49 / CLOUD-007)** — replace placeholder with BACKEND `graphql/schema.graphql`.
5. **Deploy orchestrator code (#50 / CLOUD-008)** — swap the placeholder Lambda for the real bundle.
6. **Amplify verify (#44 / CLOUD-003)** — connect frontend repo, confirm auto-deploy + env injection.

## Outputs (CfnOutput)

After `cdk deploy`, these are printed and used by follow-up issues + frontend `.env.local` (#55):

- `AppSyncUrl`, `AppSyncApiKey` → frontend `NEXT_PUBLIC_APPSYNC_URL` / `_API_KEY`
- `TableName` → DATA seed/models (#46)
- `AssetsBucketName` → scenario/lexicon/mp3 uploads
- `OrchestratorName` → code-deploy target (#50)

## Scope notes

- **Lambda handler + GraphQL schema are placeholders** so `cdk synth` passes before AGENT/BACKEND code exists. Replaced in #50 / #49.
- **Amplify Hosting app + Bedrock Guardrail resource** are added in a follow-up commit on this issue (they need a GitHub connection token / guardrail policy that aren't available at scaffold time). Tracked in the stack's closing comment.
- `cdk.json` and `package.json` are **TEAM-LOCK** files — changes go through PR with team approval.
