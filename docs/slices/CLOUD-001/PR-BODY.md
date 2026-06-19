# PR: [CLOUD] repo bootstrap — main branch protection + labels

## Related issue

Closes #42

## Why / 왜

main 보호 + PR 워크플로우는 24h 협업의 기반이다. 검토 없는 직접 push를 막고,
모든 변경이 PR + 1 approve를 거치게 한다. 이 PR로 CLOUD-002/003/006(blocked by #42)이 착수 가능해진다.

## What / 무엇을

- [x] `main` 브랜치 보호 적용 (`gh api`): 직접 push 차단, PR 1 approve, `enforce_admins`, force-push/삭제 금지
- [x] status 라벨 생성 (`in-progress`/`in-review`/`done`) — module 5 + status 4 완비
- [x] `docs/cloud/branch-protection.md` — 보호 정책·라벨 셋업 SSOT (재현 명령 포함)
- [x] `docs/cloud/branch-protection.json` — 적용된 보호 규칙 본문

## Affected modules / 영향 모듈

- `CLOUD` — docs/infra만 추가. 스키마/코드 변경 없음.
- (운영 영향) 전체 팀 — 이제 main은 PR 필수. feature → dev → main 모델.

## Test plan / 검증 방법

스키마/lint 대상 코드 없음 (infra/docs PR). `docs/slices/CLOUD-001/VERIFY.md` 참고.

- [x] `gh api .../branches/main/protection` → `protected:true, enforce_admins:true, pr_required:true`
- [x] `required_approving_review_count == 1`, `dismiss_stale_reviews == true`
- [x] `gh label list` → module 5 + status 4
- [x] `python3 -m json.tool docs/cloud/branch-protection.json` → valid

## Checklist

- [x] Acceptance 3/3 충족 (VERIFY.md §B)
- [x] 변경 파일 모두 본인(CLOUD) 영역 — docs/만
- [x] pre-push hook 통과
