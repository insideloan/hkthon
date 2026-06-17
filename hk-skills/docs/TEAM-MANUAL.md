# TEAM-MANUAL — hk-skills 기여 매뉴얼 (Claude Code 실행용)

> **이 문서는 Claude Code가 읽고 순서대로 실행하는 매뉴얼입니다.**
> 팀원이 "팀 매뉴얼 따라줘"라고 하면 이 문서를 읽고 step 1부터 실행합니다.
>
> **전제**: GitHub 계정 + collaborator 등록은 이미 완료.
> **repo**: `https://github.com/insideloan/hkthon.git`
> **로컬 경로**: `~/workspace/hkthon`

---

## 1. GitHub CLI 설치 + 인증

사용자의 OS를 판별하고 gh CLI를 설치한 뒤 인증합니다.

### 실행

```bash
# 설치 (macOS)
brew install gh

# 설치 (Linux)
sudo apt update && sudo apt install gh
```

설치 확인:
```bash
gh --version
```

이미 설치되어 있으면 skip.

### 인증

```bash
gh auth login
```

인증이 이미 되어 있으면 skip. 확인:
```bash
gh auth status
# → "Logged in to github.com" 보이면 OK
```

인증이 안 되어 있으면 사용자에게 **웹 브라우저로 인증**하라고 안내:
1. `gh auth login` 실행 시 나오는 one-time code를 복사
2. 브라우저에서 code 붙여넣기 → Authorize

---

## 2. clone

repo를 로컬에 받습니다.

### 실행

```bash
# 이미 ~/workspace/hkthon이 있으면 skip
if [[ ! -d ~/workspace/hkthon/.git ]]; then
  gh repo clone insideloan/hkthon ~/workspace/hkthon
fi
cd ~/workspace/hkthon
```

확인:
```bash
pwd && ls
# hk-skills/  docs/  .gitignore  보이면 OK
```

### 에러 대응

| 에러 | 원인 | 대응 |
|---|---|---|
| `Permission denied` | collaborator 아님 | 사용자에게 "팀 리더에게 collaborator 추가 요청하세요" 안내 |
| `Repository not found` | gh auth 안 됨 | Step 1로 돌아감 |

---

## 3. 모듈 등록

사용자의 모듈을 git config에 등록합니다. pre-push hook이 이 값으로 boundary를 검사합니다.

### 사용자에게 질문

**"본인 모듈은 무엇인가요?"** 옵션:

| 코드 | 역할 | 담당 파일 예시 |
|---|---|---|
| `QUEUE` | Outbound Call Queue | `frontend/src/components/queue/*`, `backend/app/api/queue.py` |
| `PHONE` | Customer iPhone UI | `frontend/src/components/phone/*`, `backend/app/ws/customer_ws.py` |
| `CALL` | Agent Call View | `frontend/src/components/call/*`, `backend/app/api/calls.py` |
| `SUMMARY` | Handoff Summary | `frontend/src/components/call/SummaryPanel.tsx`, `backend/app/api/summaries.py` |
| `ORCH` | Orchestrator Hub | `backend/app/scenarios/*`, `backend/app/llm/*`, `backend/app/agent/*` (이탈위험도 `churn_risk.py` 포함), `backend/app/main.py` |

### 실행

사용자가 선택한 모듈과 GitHub 정보로 등록:
```bash
cd ~/workspace/hkthon
git config user.name "<사용자-GitHub-이름>"
git config user.email "<사용자-GitHub-이메일>"
git config hk.module "<선택한-모듈>"
```

확인:
```bash
git config hk.module  # QUEUE 등 출력되면 OK
```

---

## 4. 작업 브랜치 만들기

main에서 분기합니다. **절대 main에서 직접 작업하지 않습니다.**

### 사용자에게 질문

**"무엇을 수정할 건가요? (한 줄로)"**

### 실행

```bash
cd ~/workspace/hkthon
git checkout main
git pull origin main
```

브랜치명 생성 규칙: `<MODULE>-<NNN>-<short-kebab-desc>`
- MODULE: 사용자의 `git config hk.module` 값 또는 `DOCS` (문서 변경 시)
- NNN: 3자리 번호 (001, 002 ...)
- 예: `QUEUE-001-fix-queue-color`, `DOCS-002-update-readme`, `ORCH-003-add-fallback`

```bash
git checkout -b <브랜치명>
```

---

## 5. 파일 수정

사용자가 원하는 파일을 수정합니다.

### boundary 검사 (필수)

수정 전, 대상 파일이 사용자 모듈에 속하는지 확인:
```bash
cd ~/workspace/hkthon
python3 hk-skills/scripts/check-module-boundary.py \
  --module "$(git config hk.module)" \
  --base HEAD
```

또는 `docs/MODULES.md` §2의 ownership matrix를 읽어서 판별.

**본인 모듈이 아닌 파일**을 수정해야 하면:
- 사용자에게 "이 파일은 <다른 모듈>의 파일입니다. PR로 요청하거나 해당 owner에게 음성으로 알려주세요" 안내
- 사용자가 계속 진행을 원하면 boundary 검사는 push 단계(Step 7)에서 pre-push hook이 수행

### TEAM-LOCK 파일 주의

다음 파일은 **모든 팀원 approve**가 필요:
- `docs/MODULES.md`, `docs/WORKFLOW.md`
- `frontend/package.json`, `frontend/pnpm-lock.yaml`, `frontend/tailwind.config.ts`
- `docs/reference/*`

수정해야 한다면 사용자에게 "TEAM-LOCK 파일입니다. PR에 모든 팀원이 approve해야 합니다" 안내.

### 수정 실행

사용자의 요청에 따라 Read → Edit/Write로 파일 수정.

수정 후 diff를 사용자에게 보여주고 확인:
```bash
git diff
```

---

## 6. commit

변경을 git에 기록합니다.

### 실행

```bash
cd ~/workspace/hkthon
git add -A
git status  # stage된 파일 확인
```

commit 메시지 형식: `<type>(<scope>): <subject>`
- type: `feat` / `fix` / `docs` / `chore`
- scope: 모듈명 또는 파일명
- 예: `docs(vision): clarify 5-questions format`

```bash
git commit -m "<type>(<scope>): <subject>"
```

---

## 7. push + PR

### push

```bash
cd ~/workspace/hkthon
git push -u origin <브랜치명>
```

**pre-push hook이 자동 실행**됩니다. 본인 모듈 외 파일이 섞여 있으면 push가 block됨.

hook이 막으면:
1. 위반 파일을 `git checkout -- <file>`로 되돌림
2. 본인 모듈 파일만 다시 commit + push
3. 위반 파일 변경이 필요하면 → 별도 브랜치 + PR로 분리

### PR 생성

```bash
gh pr create \
  --title "[<모듈>] <한 줄 설명>" \
  --base main
```

PR 제목 규칙: `[<모듈>] <설명>`
- 예: `[QUEUE] fix queue row color`, `[DOCS] update team manual`
- TEAM-LOCK 변경: `[TEAM-LOCK] <설명>`

PR 본문에 포함할 내용 (사용자에게 확인):
- **Why**: 왜 이 변경이 필요한가
- **What**: 무엇을 변경했는가
- **Affected modules**: 영향받는 모듈

PR URL을 사용자에게 보여줌.

---

## 8. 리뷰 + 머지

### 다른 사람 PR 검토

```bash
gh pr list
```

리뷰할 PR checkout:
```bash
gh pr checkout <PR번호>
git diff main  # 변경 내용 확인
```

승인 또는 변경 요청:
```bash
# 승인
gh pr review <PR번호> --approve

# 변경 요청
gh pr review <PR번호> --request-changes --body "<이유>"
```

머지 (승인 후):
```bash
gh pr merge <PR번호> --squash --delete-branch
```

### 규칙

- 본인이 만든 PR은 본인이 merge 못 함 (다른 팀원이)
- TEAM-LOCK PR은 **모든 팀원 approve** 필요
- Schema 변경 PR은 **ORCH owner + 사용 모듈 owner** approve 필요

---

## 9. 브랜치 최신화

다음 작업을 위해 main을 반영합니다.

```bash
cd ~/workspace/hkthon
git checkout main
git pull origin main
```

작업 브랜치가 있으면 rebase:
```bash
git checkout <작업-브랜치>
git rebase origin/main
```

충돌 시:
```bash
# 충돌 파일 수정
git add <파일>
git rebase --continue
git push --force-with-lease   # --force 절대 금지
```

---

## 트러블슈팅

| 상황 | 대응 |
|---|---|
| `gh: command not found` | `brew install gh` (macOS) 또는 `sudo apt install gh` (Linux) |
| `fatal: not a git repository` | `cd ~/workspace/hkthon` 확인. 없으면 Step 2부터 |
| pre-push hook violation | 위반 파일 `git checkout -- <file>` 되돌림 → 본인 모듈만 다시 push. 필요하면 별도 PR |
| `gh auth` 실패 | `gh auth logout && gh auth login` 재시도 |
| main에 직접 push 시도 | **금지**. PR로만 머지 |
| merge conflict | `git fetch origin && git rebase origin/main` → 충돌 해결 → `--force-with-lease` |
| `.env` 파일 commit | **즉시 사용자에게 "팀 리더에게 알리세요" 안내** (비밀 정보 노출) |

---

## 가드레일

| ❌ 금지 | ✅ 대안 |
|---|---|
| main에 직접 push | PR로 merge |
| `--force` push | `--force-with-lease` |
| `--no-verify` (hook 우회) | 위반 파일 revert 후 다시 push |
| 본인 모듈 외 파일 직접 push | PR로 owner에게 요청 |
| `.env` 파일 commit | `.env.example`만 공유 |
| API key 포함 commit | 키는 본인 `.env`에만 |
