# Branch Protection & Label Setup — CLOUD-001

> **목적**: `main` 브랜치 보호 + PR 워크플로우 기반을 마련한다.
> main에 직접 push를 막고, 모든 변경은 PR + 1 approve를 거치게 한다.
> 이 문서는 보호 정책·라벨 셋업의 SSOT다.

관련 issue: **CLOUD-001** (`module:cloud` — solduma)

---

## 1. 브랜치 모델 / Branch model

```
feature/*  ──PR──►  dev  ──PR──►  main
```

- **feature 브랜치** (`CLOUD-001-...`, `BACKEND-003-...` 등): 작업 단위. issue 1개 = 브랜치 1개.
- **dev**: 팀 통합 브랜치. feature PR이 머지되는 곳. `pre-push` hook이 diff base로 사용 (`HK_INTEGRATION_BRANCH=dev`).
- **main**: 보호 브랜치. 배포 기준선. `dev`가 통합 완료되면 PR로 승격.

> PR의 `--base`는 통합 시점엔 `dev`, 릴리스 승격 시엔 `main`.

---

## 2. main 브랜치 보호 정책 / Protection policy

`main`에 적용된 규칙 (GitHub Branch Protection):

| 규칙 | 값 | 이유 |
|---|---|---|
| 직접 push 금지 | ✅ (PR 필수) | 검토 없는 변경 차단 |
| PR approve 필요 | **1명 이상** | 최소 1명 리뷰 |
| stale review dismiss | ✅ | 새 commit 시 기존 approve 무효화 |
| force push 금지 | ✅ | history 보호 |
| branch 삭제 금지 | ✅ | main 보호 |
| admin에게도 적용 | ✅ (`enforce_admins`) | 우회 방지 |

> CI status check(`CLOUD-002`/`CLOUD-006`)는 해당 워크플로우가 생긴 뒤 이 정책의 `required_status_checks`에 추가한다 (이 issue 범위 밖).

### 2.1 적용 방법 (재현용)

repo admin이 1회 실행 (이미 적용됨):

```bash
gh api -X PUT repos/insideloan/hkthon/branches/main/protection \
  --input docs/cloud/branch-protection.json
```

규칙 본문은 [`branch-protection.json`](./branch-protection.json) 참고.

### 2.2 확인 방법

```bash
# 보호 규칙 활성 확인 (404 가 아니면 활성)
gh api repos/insideloan/hkthon/branches/main/protection \
  --jq '{pr_required: .required_pull_request_reviews.required_approving_review_count, enforce_admins: .enforce_admins.enabled}'

# main 직접 push 차단 확인 (거부되어야 정상)
git push origin HEAD:main        # → ! [remote rejected] (protected branch)
```

---

## 3. 라벨 셋업 / Label setup

24h 워크플로우 추적용 라벨. **module 라벨**(어느 모듈) + **status 라벨**(어느 단계).

### 3.1 Module 라벨 (5 modules)

| 라벨 | 모듈 / owner | 색상 |
|---|---|---|
| `module:cloud` | CLOUD · 일조 | `#5319e7` |
| `module:data` | DATA · 수민 | `#0e8a16` |
| `module:agent` | AGENT · 은경 | `#d93f0b` |
| `module:backend` | BACKEND · 지원 | `#1d76db` |
| `module:frontend` | FRONTEND · 주실 | `#fbca04` |

### 3.2 Status 라벨 (lifecycle)

| 라벨 | 의미 | 색상 |
|---|---|---|
| `status:ready` | 착수 가능 (slice 완료) | `#c2e0c6` |
| `status:in-progress` | 구현 중 (hk-implement) | `#fbca04` |
| `status:in-review` | PR 리뷰 중 | `#0e8a16` |
| `status:done` | 머지 완료 | `#5319e7` |

흐름: `ready → in-progress → in-review → done`

### 3.3 라벨 재생성 (재현용)

```bash
# module 라벨
gh label create "module:cloud"    --color 5319e7 --description "CLOUD · 일조"
gh label create "module:data"     --color 0e8a16 --description "DATA · 수민"
gh label create "module:agent"    --color d93f0b --description "AGENT · 은경"
gh label create "module:backend"  --color 1d76db --description "BACKEND · 지원"
gh label create "module:frontend" --color fbca04 --description "FRONTEND · 주실"

# status 라벨
gh label create "status:ready"       --color c2e0c6 --description "착수 가능"
gh label create "status:in-progress" --color fbca04 --description "진행 중"
gh label create "status:in-review"   --color 0e8a16 --description "리뷰 중"
gh label create "status:done"        --color 5319e7 --description "완료"
```

> `gh label create`는 이미 있는 라벨에 대해 실패하므로 멱등하게 쓰려면 `|| gh label edit` 패턴 사용.

---

## 4. Acceptance 검증 / Verification

| Acceptance | 검증 방법 | 결과 |
|---|---|---|
| main 직접 push 차단 | `gh api .../protection` → `protected:true`, `enforce_admins:true`, force-push/deletion `false` (PR 강제) | ✅ |
| PR 1 approve 필요 | `gh api .../protection` → `required_approving_review_count == 1`, `dismiss_stale_reviews == true` | ✅ |
| module/status 라벨 존재 | `gh label list` → module 5 + status 4 | ✅ |

> AC1 검증은 보호 규칙 config로 증명한다. `git push origin HEAD:main` 실거부 테스트는 보호된 default 브랜치를 실제로 건드리므로 수행하지 않는다 (config가 `pr_required_for_push:true`면 동일하게 보장됨).
