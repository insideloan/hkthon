# Verify Checklist — `CLOUD-001` (레포 부트스트랩 + 브랜치 보호)

> **`hk-verify` skill이 채웁니다. 비개발자가 코드 없이 한 줄씩 체크.**
> 이 issue는 infra/docs 성격(backend/frontend/WS/LLM 없음)이라 관련 섹션만 남김.

관련 issue: **#42** · 변경 파일: `docs/cloud/branch-protection.md`, `docs/cloud/branch-protection.json`, `docs/slices/CLOUD-001/VERIFY.md`

---

## A. 자동 검증 / Auto Verify

> Claude가 자동 실행. 결과만 확인하세요. (복붙해서 그대로 실행 가능)

- [ ] **보호 규칙 활성** — 404가 아니어야 함
  ```bash
  gh api repos/insideloan/hkthon/branches/main/protection \
    --jq '{protected:true, pr_required:(.required_pull_request_reviews!=null), enforce_admins:.enforce_admins.enabled}'
  # 기대: {"protected":true,"pr_required":true,"enforce_admins":true}
  ```
- [ ] **JSON 유효성** — 정책 파일이 valid JSON
  ```bash
  python3 -m json.tool docs/cloud/branch-protection.json > /dev/null && echo OK
  ```

---

## B. 수용 기준 (Issue #42 §Acceptance) / Acceptance Criteria

issue의 `## Acceptance`에서 그대로 복사. 각 줄을 확인:

- [ ] **main 직접 push 차단 확인**
  ```bash
  gh api repos/insideloan/hkthon/branches/main/protection \
    --jq '{enforce_admins:.enforce_admins.enabled, force_push:.allow_force_pushes.enabled, deletions:.allow_deletions.enabled}'
  # 기대: {"enforce_admins":true,"force_push":false,"deletions":false}
  # → admin 포함 누구도 직접 push 불가, PR 필수
  ```
- [ ] **PR 1 approve 필요**
  ```bash
  gh api repos/insideloan/hkthon/branches/main/protection \
    --jq '.required_pull_request_reviews.required_approving_review_count'
  # 기대: 1
  ```
- [ ] **module/status 라벨 존재**
  ```bash
  gh label list --json name \
    --jq '{module:[.[].name|select(startswith("module:"))]|length, status:[.[].name|select(startswith("status:"))]|length}'
  # 기대: {"module":5,"status":4}
  ```

> AC1의 `git push origin HEAD:main` 실거부 테스트는 보호된 default 브랜치를 실제로 건드리므로 수행하지 않음. config(`enforce_admins:true` + PR 강제)가 동일하게 보장.

---

## G. 데모 가능성 (최종) / Demoability

- [ ] 이 issue가 PR 워크플로우 + 라벨 기반을 마련 → CLOUD-002/003/006(blocked by #42) 착수 가능
- [ ] 다른 모듈 작업과 충돌 없음 (docs/infra만 변경)
- [ ] issue status가 `in-review` → 머지 후 `done` 준비됨

---

## 결과 / Result

- [ ] **PASS** — 모든 항목 체크
- [ ] **FAIL** — 실패 항목 있음, hk-implement로 회귀

```
FAIL: <항목> — <사유>
```
