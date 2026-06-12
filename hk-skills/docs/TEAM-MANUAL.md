# TEAM-MANUAL — 팀원이 hk-skills를 받아 수정하고 업데이트하는 매뉴얼

> **이 문서는 Claude Code가 읽고 순서대로 수행하는 매뉴얼입니다.**
> 비개발자 팀원이 git을 모르더라도, Claude Code에게 "팀 매뉴얼 따라줘"라고 하면 처음부터 끝까지 가이드합니다.
>
> **전제**: GitHub 계정 + collaborator 등록은 이미 완료된 상태입니다.
>
> **모든 절차는 Claude Code를 통해 진행합니다.** 터미널 명령은 사용자가 직접 치는 것이 아니라 Claude Code가 안내합니다.

---

## 0. 어디서 무엇을 하나 (Overview)

| 단계 | 무엇을 하나 | 결과 |
|---|---|---|
| 1 | GitHub CLI 설치 + 인증 | `gh auth status` OK |
| 2 | hk-skills 받기 (clone) | 본인 노트북에 폴더 |
| 3 | 본인 모듈 등록 | git config에 모듈 기록 |
| 4 | 작업 브랜치 만들기 | main에서 분기 |
| 5 | 파일 수정 (스킬/문서) | 본인 모듈 안에서만 |
| 6 | 변경 내용 stage + commit | git history에 기록 |
| 7 | push + PR 만들기 | 검토 요청 |
| 8 | 리뷰 받기 + 머지 | main에 반영 |
| 9 | 본인 브랜치 최신화 | 다음 작업을 위해 |

---

## 매뉴얼 본문

### STEP 1. GitHub CLI 설치 + 인증

**Claude에게 할 말**: `팀 매뉴얼 step 1 따라해줘`

**Claude가 할 일**:
1. macOS / Linux 판별
2. OS에 맞는 설치 명령 실행:

   **macOS**:
   ```bash
   brew install gh
   ```

   **Linux (Debian/Ubuntu)**:
   ```bash
   sudo apt update
   sudo apt install gh
   ```

3. 설치 확인:
   ```bash
   gh --version
   ```

4. 인증 (사용자가 직접 입력):
   ```bash
   gh auth login
   ```
   - `GitHub.com` 선택
   - `HTTPS` 선택
   - `Login with a web browser` 선택 (간편)
   - 화면에 표시된 one-time code 복사
   - 브라우저가 열리면 code 붙여넣기 → Authorize

5. 인증 확인:
   ```bash
   gh auth status
   ```
   → `Logged in to github.com as <username>` 나오면 OK

**문제 해결**:
- `gh: command not found`: 터미널 재시작 또는 `source ~/.zshrc` (macOS)
- 브라우저가 안 열리면: `--web` 옵션 안 붙이고 다시 시도

---

### STEP 2. hk-skills 받기 (clone)

**Claude에게 할 말**: `팀 매뉴얼 step 2 따라해줘`

**Claude가 할 일**:
1. 어디에 받을지 사용자에게 확인 (기본: `~/workspace/hkthon`)
2. collaborator 권한으로 직접 clone:
   ```bash
   gh repo clone insideloan/hkthon ~/workspace/hkthon
   cd ~/workspace/hkthon
   ```
3. **올바른 디렉토리**에 들어왔는지 확인:
   ```bash
   pwd
   ls
   # hk-skills/  docs/  .gitignore  .git/  ... 보이면 OK
   ```
4. 원격 정보 확인:
   ```bash
   git remote -v
   # origin  https://github.com/insideloan/hkthon.git (fetch)
   # origin  https://github.com/insideloan/hkthon.git (push)
   ```

**문제 해결**:
- `Permission denied`: collaborator 등록이 안 됨. 팀 리더에게 추가 요청
- `Repository not found`: gh auth가 안 됐을 수 있음. Step 1 다시

---

### STEP 3. 본인 모듈 등록 (git config)

**Claude에게 할 말**: `팀 매뉴얼 step 3 따라해줘`

**Claude가 할 일**:
1. 사용자가 어떤 모듈 owner인지 확인. 옵션:
   - `QUEUE` (Person A) — Outbound Call Queue
   - `PHONE` (Person B) — Customer iPhone UI
   - `CALL` (Person C) — Agent Call View
   - `MEMO` (Person C) — Memo Popup
   - `ORCH` (Person D) — Orchestrator Hub
2. 본인 모듈 한 개만 선택 (1인 1모듈)
3. git config 등록:
   ```bash
   cd ~/workspace/hkthon
   git config user.name "<본인-GitHub-이름>"
   git config user.email "<본인-GitHub-이메일>"
   git config hk.module "<QUEUE|PHONE|CALL|MEMO|ORCH>"
   ```
4. 확인:
   ```bash
   git config hk.module
   git config user.name
   git config user.email
   ```

**왜 이게 필요한가**:
- `pre-push` hook이 본인 모듈 안의 파일만 push할 수 있도록 검사
- 실수로 다른 모듈 파일을 건드려도 push 단계에서 막아줌

---

### STEP 4. 작업 브랜치 만들기

**Claude에게 할 말**: `팀 매뉴얼 step 4 따라해줘. <수정-목적-한-줄>`

**Claude가 할 일**:
1. main 브랜치에서 시작:
   ```bash
   cd ~/workspace/hkthon
   git checkout main
   git pull origin main
   ```
2. 브랜치명 생성 (Claude가 제안):
   - 형식: `<module>-<nnn>-<short-kebab-desc>`
   - 예: `DOCS-001-update-readme-typo`, `ORCH-002-fix-prompt-formatting`
3. 브랜치 만들기:
   ```bash
   git checkout -b <브랜치명>
   ```
4. 확인:
   ```bash
   git branch --show-current
   ```

**규칙**:
- 절대 main에서 직접 작업 안 함
- 작업 1건 = 브랜치 1개
- 브랜치명에는 모듈 prefix (DOCS/QUEUE/PHONE/CALL/MEMO/ORCH) 필수

---

### STEP 5. 파일 수정 (스킬/문서)

**Claude에게 할 말**: `팀 매뉴얼 step 5 따라해줘. <파일-경로> 수정할 거야`

**Claude가 할 일**:
1. **무엇을 수정할지** 사용자에게 명확히 확인
2. **어떤 파일인지** 절대 경로로 확인:
   ```bash
   ls -la hk-skills/skills/hk-vision/
   # SKILL.md
   ```
3. **모듈 boundary 확인** (Claude가 자동):
   - 수정하려는 파일이 본인 모듈(`git config hk.module`)에 속하는지
   - 안 속하면 → 다른 사람 것. **PR로 요청** (Step 6-8) 또는 팀 리더에게 음성
4. **파일 수정** (Claude가 Read → Edit/Write로 직접 수행)
5. **수정 내용 미리보기**:
   ```bash
   git diff
   ```
6. 사용자에게 "이 변경이 맞나요?" 확인

**자주 수정하는 파일** (예시):
- 본인 모듈의 `SKILL.md` — 가이드 문서
- `docs/reference/PRODUCT-BRIEF.md` (TEAM-LOCK, 4명 합의 필요)
- `hk-skills/README.md` (TEAM-LOCK)
- `docs/scenarios/README.md` (shared, 누구나 가능)

**수정하면 안 되는 파일** (다른 사람 모듈):
- `git config hk.module`에 없는 모듈의 모든 파일
- `MODULES.md`, `WORKFLOW.md` (TEAM-LOCK, 합의 필요)
- `tailwind.config.ts`, `package.json` (TEAM-LOCK)

---

### STEP 6. 변경 내용 stage + commit

**Claude에게 할 말**: `팀 매뉴얼 step 6 따라해줘`

**Claude가 할 일**:
1. 변경된 파일 확인:
   ```bash
   git status
   ```
2. 모든 변경 파일 stage:
   ```bash
   git add .
   ```
   또는 특정 파일만:
   ```bash
   git add hk-skills/skills/hk-vision/SKILL.md
   ```
3. 무엇이 stage됐는지 확인:
   ```bash
   git status
   git diff --cached
   ```
4. **commit 메시지 작성** (Claude가 사용자와 함께 작성):
   - 형식: `<type>(<scope>): <subject>`
   - type: `feat` (새 기능) / `fix` (버그) / `docs` (문서) / `chore` (기타)
   - 예: `docs(vision): clarify 5-questions format`
   - 예: `fix(implement): add CORS example to troubleshooting`
5. commit:
   ```bash
   git commit -m "<type>(<scope>): <subject>"
   ```
6. 확인:
   ```bash
   git log -1
   ```

**규칙**:
- commit은 1개의 논리적 변경 = 1 commit
- 너무 큰 변경은 여러 commit으로 분할
- commit 메시지는 **무엇을 왜** 했는지 명확히

---

### STEP 7. push + PR 만들기

**Claude에게 할 말**: `팀 매뉴얼 step 7 따라해줘`

**Claude가 할 일**:
1. main에서 분기한 본인 브랜치인지 확인:
   ```bash
   git branch --show-current
   ```
2. **pre-push hook 자동 검증**: 본인 모듈 안의 파일만 있는지 검사
   ```bash
   git push -u origin <브랜치명>
   ```
3. 만약 hook이 막으면 (`violation: <file> owned by PHONE`):
   - 그 파일 변경을 `git checkout -- <file>`로 되돌리기
   - 또는 **별도 PR**로 분리
   - Claude가 자동으로 처리
4. push 성공하면 PR 생성:
   ```bash
   gh pr create \
     --title "[<모듈>] <한 줄 설명>" \
     --body "<어디 왜 무엇>" \
     --base main
   ```
5. **PR 본문** (Claude가 사용자와 함께 작성):
   - **Why**: 왜 이 변경이 필요한가
   - **What**: 무엇을 변경했는가
   - **Affected modules**: 어떤 모듈에 영향
   - **Test plan**: 어떻게 검증했는가
   - **Related issue**: (있으면 #이슈번호)
6. PR URL을 사용자에게 보여줌 (예: `https://github.com/insideloan/hkthon/pull/42`)

**PR 제목 규칙**:
- 형식: `[<모듈>] <한 줄 설명>`
- 예: `[VISION] clarify 5-questions format`
- 예: `[ORCH] add CORS example to troubleshooting`
- 예: `[TEAM-LOCK] add Korea timezone to conventions` (TEAM-LOCK은 모두 approve 필요)

**팀원에게 알림**:
- 본인 PR은 직접 merge 못 함 (다른 팀원이 approve + merge)
- Discord/Slack에 PR URL 공유

---

### STEP 8. 리뷰 받기 + 머지

**Claude에게 할 말**: `팀 매뉴얼 step 8 따라해줘`

**Claude가 할 일**:
1. PR 상태 확인:
   ```bash
   gh pr view <PR번호>
   ```
2. **본인 PR이 아닌 다른 사람 PR을 검토**할 차례 (팀 매뉴얼의 정신: 서로 리뷰):
   ```bash
   gh pr list
   ```
3. 리뷰할 PR checkout:
   ```bash
   gh pr checkout <PR번호>
   ```
4. 변경 내용 확인:
   ```bash
   git diff main
   ```
5. 로컬에서 직접 검증 (스킬 변경의 경우):
   ```bash
   # install.sh가 바뀌었으면 본인 환경에서 한 번 실행
   bash install.sh --verify
   ```
6. **승인 또는 변경 요청**:
   ```bash
   # 승인
   gh pr review <PR번호> --approve

   # 변경 요청
   gh pr review <PR번호> --request-changes --body "<이유>"
   ```
7. **머지** (승인 후):
   ```bash
   gh pr merge <PR번호> --squash --delete-branch
   ```

**규칙**:
- 1시간 SLA (다른 사람 PR이 안 머지되면 본인 작업 막힘)
- 본인이 만든 PR은 본인이 merge 못 함 (다른 사람이)
- TEAM-LOCK PR은 **모든 팀원 approve** 필요
- Schema 변경 PR은 **ORCH owner + 사용 모듈 owner** approve 필요

---

### STEP 9. 본인 브랜치 최신화

**Claude에게 할 말**: `팀 매뉴얼 step 9 따라해줘`

**Claude가 할 일**:
1. main으로 돌아오기:
   ```bash
   git checkout main
   git pull origin main
   ```
2. 본인 작업 브랜치에 main 내용 반영 (rebase):
   ```bash
   git checkout <작업-브랜치>
   git rebase origin/main
   ```
3. 충돌이 있으면:
   ```bash
   # 충돌 파일 열어서 수정
   git add <해결된-파일>
   git rebase --continue
   ```
4. **절대 `--force` 사용 금지**. `--force-with-lease`만:
   ```bash
   git push --force-with-lease
   ```
5. 다음 작업 시작

---

## 자주 발생하는 문제 / Troubleshooting

### "gh: command not found"
```bash
# macOS
brew install gh

# Linux
sudo apt install gh

# 둘 다 안 되면
# https://cli.github.com/manual/installation 참고
```

### "fatal: not a git repository"
```bash
cd ~/workspace/hkthon
pwd
# /Users/<name>/workspace/hkthon 보이지 않으면 clone 다시
```

### "pre-push hook이 push를 막음" (boundary violation)
```
[check] ❌ 1 violation(s):
  - backend/app/ws/agent_ws.py  (owned by QUEUE)   ← OK
  - frontend/src/components/phone/PhoneFrame.tsx  (owned by PHONE)  ← VIOLATION
```

**Claude가 자동으로**:
1. 위반 파일을 `git checkout -- <file>`로 되돌림
2. 본인 모듈 파일만 다시 push
3. 만약 그 파일 변경이 필요했던 거면 → **별도 PR**로 분리

### "Authentication failed"
```bash
gh auth logout
gh auth login
```

### "branch 'main' is protected"
- main에 직접 push 시도 = 잘못
- PR로만 머지 (Step 7-8)

### "merge conflict"
```bash
git fetch origin
git rebase origin/main
# 충돌 파일 수정
git add <파일>
git rebase --continue
git push --force-with-lease
```

### "PR이 안 보여요"
```bash
gh pr list --author @me
```

---

## 비개발자 팀원 FAQ

**Q. git이 뭔가요?**
A. 파일 변경 이력을 추적하는 도구. Google Docs 버전 관리의 코드 버전.

**Q. GitHub가 뭔가요?**
A. git으로 관리하는 파일을 클라우드에 올려서 다른 사람과 공유하는 서비스.

**Q. GitHub CLI(`gh`)가 뭔가요?**
A. GitHub를 터미널에서 쓸 수 있게 해주는 도구. Claude Code가 모든 명령을 자동으로 입력해줍니다.

**Q. 왜 브랜치를 따로 만들어야 하나요?**
A. 여러 사람이 같은 파일을 동시에 수정해도 충돌 없이 작업하기 위해.

**Q. PR이 뭔가요?**
A. "내 변경 사항을 검토하고 main에 합쳐주세요"라는 요청.

**Q. squash merge가 뭔가요?**
A. 여러 commit을 1개로 합쳐서 main에 머지. history가 깨끗.

**Q. `--force-with-lease`는 안전한가요?**
A. 네. 다른 사람이 push한 commit을 덮어쓰지 않는 안전장치가 있는 force push.

**Q. 실수로 잘못 push했어요**
A. Claude에게 "PR 닫고 다시 할게요"라고 말하면 됩니다. PR close는 reversible.

**Q. .env 파일을 실수로 commit했어요**
A. **즉시 팀 리더에게 알림** (API key 등 비밀 정보 노출). Claude가 history에서 제거하는 방법 안내.

---

## 한 줄 명령어 모음 (자주 쓰는 것)

| 목적 | 명령 |
|---|---|
| 본인 변경 상태 보기 | `git status` |
| 본인 변경 내용 보기 | `git diff` |
| main 최신으로 | `git checkout main && git pull` |
| 새 브랜치 | `git checkout -b <이름>` |
| 파일 되돌리기 | `git checkout -- <파일>` |
| 변경 stage | `git add <파일>` |
| commit | `git commit -m "<메시지>"` |
| push | `git push -u origin <브랜치>` |
| PR 만들기 | `gh pr create` |
| PR 목록 | `gh pr list` |
| 본인 PR 보기 | `gh pr list --author @me` |
| PR 머지 | `gh pr merge <번호> --squash --delete-branch` |
| 본인 모듈 보기 | `git config hk.module` |

---

## Claude Code에게 도움 요청하는 법

**"처음부터 끝까지 다 해줘"**:
- "팀 매뉴얼 step 1부터 step 9까지 다 따라해줘"
- "GitHub CLI 설치부터 PR 머지까지 가이드해줘"

**"특정 단계만"**:
- "step 7만 도와줘" (push + PR)
- "PR이 conflict 났는데 어떻게 해결해?"

**"문제 해결"**:
- "hook이 push를 막았어" → Step 5의 모듈 boundary 섹션 참고
- "merge conflict 났어" → Troubleshooting 참고
- "PR이 안 보여" → `gh pr list` 실행

**"다른 사람 도움"**:
- "OO의 PR 리뷰 좀 봐줘" → Step 8의 reviewer 섹션
- "OO의 브랜치에 내가 추가로 변경하고 싶어" → 별도 브랜치 + PR

---

## 안전 규칙 (반드시 지킬 것)

| ❌ 절대 안 됨 | ✅ 대신 이렇게 |
|---|---|
| main에 직접 push | PR로 merge |
| `--force` push | `--force-with-lease` |
| `--no-verify` (hook 우회) | 위반 파일 revert 후 PR |
| 본인 모듈 외 파일 변경 | PR로 owner에게 요청 |
| `.env` 파일 commit | `.env.example`만 공유 |
| API key를 commit에 포함 | 키는 본인 .env에만 |
| 다른 사람 모듈을 자기 PR에 섞기 | 모듈별로 PR 분리 |

---

## 다음 단계

이 매뉴얼을 따라 한 번 작업해보세요. 가장 좋은 학습은 **직접 해보는 것**입니다.

**첫 번째 추천 작업** (연습용, 누구나 가능):
1. 본인 모듈의 SKILL.md 오타 하나 수정
2. commit + push + PR
3. 다른 팀원 PR 1개 approve + merge
4. 이 매뉴얼을 본인의 경험에 맞춰 수정 (TEAM LOCK PR)

**도움이 필요하면**:
- 이 문서를 Claude Code에게 다시 보여주세요
- "팀 매뉴얼 step X에서 막혔어"라고 하세요
