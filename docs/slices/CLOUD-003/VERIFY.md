# Verify Checklist — `CLOUD-003` (#44)

> Frontend 배포 (Amplify) 파이프라인. Amplify 앱 생성은 #54, repo 연결은 콘솔(GitHub App).

## 수용 기준 (#44) — 2026-06-20 실측

- [x] main 머지 시 자동 빌드/배포 동작
  - GitHub App webhook 설치됨 → main push → Amplify job #3 자동 트리거
  - BUILD / DEPLOY / VERIFY 전부 SUCCEED
- [x] 배포 URL 200
  - `https://main.d358kkr1l9ymzm.amplifyapp.com` → HTTP **200**, placeholder 페이지("AI 상담 코파일럿") 렌더
- [x] 환경변수 주입 확인
  - `NEXT_PUBLIC_APPSYNC_URL`, `AMPLIFY_MONOREPO_APP_ROOT=frontend` (CDK 주입)

## 연결 구성 (콘솔, owner)

- repo `insideloan/hkthon`, branch `main` (PRODUCTION), monorepo root `frontend`
- platform WEB_COMPUTE (Next.js 15 SSR), service role `amplifyconsole-backend-role`
- WAF skip (스코프 외), backend env 미연결 (백엔드는 별도 CDK 스택)

## 빌드 트러블슈팅 (해결됨)

1. "Root directory cannot be found" → main에 `frontend/` 없었음 → placeholder 앱 머지(#64)로 해결.
2. `pnpm: command not found` → 콘솔 자동감지 buildSpec이 CDK buildSpec 덮어씀 → CDK buildSpec 재배포(corepack).
3. `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` (semver@7.8.5) → `pnpm@latest`의 공급망 정책 vs 로컬 버전 불일치 → `packageManager: pnpm@10.34.4` 핀 + buildSpec에서 `@latest` 제거(#65)로 해결.

## 범위 메모

- `frontend/`는 **placeholder**(CLOUD-003 배포 검증용). 실제 화면은 FRONTEND-001+ (주실)이 교체.
- buildSpec/next.config/package.json은 CLOUD/TEAM-LOCK 소유.

## 결과
- [x] **PASS** — 자동배포 파이프라인 end-to-end 동작, URL 200.
