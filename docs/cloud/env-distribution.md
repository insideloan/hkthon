# Env Distribution — frontend `.env.local` (CLOUD-012 / #55)

> 각 개발자가 `frontend/.env.local`에 넣어야 하는 AppSync URL/API key를
> **안전하게** 받아가는 방법. 값은 `cdk deploy`의 CfnOutput에서만 나오며
> **git에 절대 커밋하지 않는다** (STACK.md §2 시크릿 위생).

## 1. 값 받기 (각자 본인 머신에서)

`ap-northeast-2` 자격증명이 설정된 상태에서:

```bash
aws cloudformation describe-stacks --stack-name HkthonStack \
  --query "Stacks[0].Outputs[?OutputKey=='AppSyncUrl' || OutputKey=='AppSyncApiKey'].{k:OutputKey,v:OutputValue}" \
  --output table
```

> 자격증명이 없는 팀원은 CLOUD(일조)에게 요청 — **Slack DM/1Password 등 비공개 채널로만** 전달. 메신저 공개 채널·git·이슈/PR 본문에 붙이지 않는다.

## 2. `.env.local` 작성 (FRONTEND 디렉터리)

```bash
cd frontend
cat > .env.local <<EOF
NEXT_PUBLIC_APPSYNC_URL=<AppSyncUrl 값>
NEXT_PUBLIC_APPSYNC_API_KEY=<AppSyncApiKey 값>
EOF
```

`.env.local`은 Next.js 기본 `.gitignore` 대상이며, 우리 레포 `.gitignore`에도 `.env*`가 있어야 한다(아래 3 확인). `.env.example`(키 이름만)만 커밋한다.

## 3. 커밋 안 됨 확인

```bash
git check-ignore frontend/.env.local   # 출력 있으면 ignore됨(정상)
git ls-files | grep -E '\.env\.local$' # 출력 없어야 정상
```

## 4. 연결 확인 (introspection 200)

```bash
curl -s -X POST "$NEXT_PUBLIC_APPSYNC_URL" \
  -H "x-api-key: $NEXT_PUBLIC_APPSYNC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __typename }"}'
# => {"data":{"__typename":"Query"}}  (200)
```

## 주의 / Caveats

- **API key는 30일 만료** (AppSync API_KEY 인증). 만료 시 재배포로 갱신 → 팀 재공유.
- key가 `cdk deploy`/CfnOutput으로 바뀌면 각자 `.env.local` 갱신.
- 정식 배포 환경변수(Amplify Console 주입)는 #44에서 처리 — 본 문서는 **로컬 개발용**.
- ⚠️ 이 문서에는 **실제 키 값을 적지 않는다.** 항상 CFN 출력에서 조회.
