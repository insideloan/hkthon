# Verify Checklist — `CLOUD-012` (#55)

> AppSync URL/key를 frontend `.env.local`로 안전 배포. 값은 CfnOutput, git 커밋 금지.

## 수용 기준 (#55) — 2026-06-19 실측

- [x] AppSync URL/key가 CfnOutput으로 노출 → `AppSyncUrl`, `AppSyncApiKey`
- [x] `.env.local` 채운 뒤 `curl $NEXT_PUBLIC_APPSYNC_URL` introspection **200** (`{"data":{"__typename":"Query"}}`)
- [x] 키가 git에 커밋되지 않음 → `.gitignore`에 `.env`/`.env.local`/`.env.*.local` 추가, `git check-ignore frontend/.env.local` 통과

## 산출물

- `docs/cloud/env-distribution.md`: 값 받기(CFN 조회) → `.env.local` 작성 → 커밋 안 됨 확인 → introspection 검증. 실제 키 값은 문서에 미기재.
- `.gitignore`: `.env*` 패턴 추가 (이전엔 없어서 `.env.local` 커밋 위험이 있었음 — 이번에 보강).

## 범위 메모

- 로컬 개발용. 정식 배포 env 주입(Amplify Console)은 #44.
- API key 30일 만료 → 재배포 시 팀 재공유 필요.

## 결과
- [x] **PASS**
