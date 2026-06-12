---
name: hk-implement
description: 본인 owner의 GitHub issue 1개를 실제로 구현. pre-push hook이 모듈 boundary 자동 체크. 끝나면 PR로 hand-off.
---

# hk-implement — Issue 구현 / Implement an Issue

> **목적 / Purpose**: 본인 owner의 GitHub issue 1개를 (1-2시간 안에) acceptance criteria 전부 충족하도록 구현. **24h 안의 workhorse**.
> In 1-2h, implement your owned GitHub issue meeting all acceptance criteria. The 24h workhorse.

> **모듈 boundary는 자동 강제됩니다.** `pre-push` hook이 push 시점에 본인이 owner가 아닌 모듈 파일이 섞여 있으면 push를 block합니다.

---

## 1. 언제 쓰나 / When to use

- `hk-slice`가 끝나고 본인 OWNER.md에 `ready`로 표시된 issue가 있을 때.
- 또는 `hk-verify`가 FAIL이라 같은 issue를 재구현할 때.

**트리거**:
- "이제 구현 시작" / "implement QUEUE-001"
- "issue 끝내자"

---

## 2. 입력 / Input

- 본인 GitHub issue (`gh issue view <num>`)
- `docs/MODULES.md` §2 (file ownership matrix — **반드시 확인**)
- `reference/ARCHITECTURE.md`, `STACK.md`, `CONVENTIONS.md`
- `OWNER.md` (본인 issue가 in_progress로 표시되어야 함)

> **본인 issue가 아니면 시작 금지.** `OWNER.md` 또는 `gh issue view --json assignees`로 확인.

---

## 3. 진행 / Process

### 3.1 Pre-flight (5분)

본인 issue를 처음부터 끝까지 읽고:

1. **Acceptance criteria** (`## Acceptance`) — 각 줄이 끝나면 채워야 함
2. **Module** — 본인 owner 모듈과 일치하는지 (`docs/MODULES.md`의 본인 모듈)
3. **Files I expect to change** — 전부 본인 모듈 안인지
4. **Shared files** — 다른 사람 모듈 파일이면 → PR로 처리 (push 안 됨)
5. **Dependencies (blocked by)** — 모두 `done`인지

**OK면 진행. 아니면 hk-slice로 돌아가서 조정.**

### 3.2 Issue status + 브랜치 (2분)

```bash
# issue status: ready → in-progress
gh issue edit <num> \
  --remove-label "status:ready" \
  --add-label "status:in-progress"

# 브랜치 생성 (이슈 번호와 일치!)
git fetch origin
git checkout -b <MODULE>-<NNN>-<short-desc> origin/main
```

브랜치명은 **issue title과 정확히 일치**해야 추적 가능.

### 3.3 PLAN을 먼저 사용자에게 보여주기 (5분)

코딩 시작 **전**, 다음을 한국어로:

```
"이 issue 구현 계획은:

1. <파일>: <무엇을>
2. <파일>: <무엇을>
3. <파일>: <무엇을>

순서대로 만들고 마지막에 acceptance criteria 검증할게요.
좋으면 시작합시다."
```

**사용자가 plan을 보고 "OK" 하기 전엔 코드 작성 안 함.** 비개발자가 의도 안 맞는 코드 1시간치 작업하는 것 방지.

### 3.4 구현 (45-90분)

**반드시 따르는 규칙**:

#### 모듈 boundary (가장 중요!)

- `docs/MODULES.md` §2의 matrix 보고 **본인 모듈 파일만** edit
- 다른 모듈 파일이 필요하면:
  1. issue의 `Shared files`에 적힌 것 → **PR** (이 issue에서 push 안 됨, 별도 PR)
  2. 적히지 않은 것 발견 시 → **STOP, owner에게 음성/메신저 알림**
- `pre-push` hook이 자동 검증. 위반 시 push가 **block**됨

> **hook이 막으면**: 해당 파일을 revert (`git checkout -- <file>`) 후 다시 push. PR이 필요한 변경이면 그 파일만 별도 브랜치 + PR.

#### Backend (Python/FastAPI)

- `reference/ARCHITECTURE.md` §5의 디렉토리 위치
- type hints, `logging`, ORM (SQLModel) only, raw SQL 금지
- LLM: `app/llm/router.py`의 `stream_chat`만 호출
- WebSocket: schema (`STACK.md` §5) 준수

#### Frontend (TypeScript/Next.js)

- `src/components/<area>/<Name>.tsx`
- wrapper `src/components/ui/*` 통해서 (`CONVENTIONS.md` §6.1)
- inline `style={{}}` 금지
- `any` 금지, 모든 함수에 타입
- WebSocket: `lib/ws.ts` 통해서
- API: `lib/api.ts` 통해서

#### 자주 쓰는 패턴

| 상황 | 패턴 |
|---|---|
| 새 API endpoint | `app/api/<thing>.py` router, `app/main.py`에 `app.include_router(...)` |
| 새 DB 테이블 | `app/models/<thing>.py` SQLModel, `python -m app.db_init` |
| 새 WebSocket 메시지 | `app/ws/<agent|customer>_ws.py` handler (schema 변경은 ORCH PR) |
| 새 Frontend 페이지 | `src/app/<route>/page.tsx` |
| 새 wrapper | `src/components/ui/<Name>.tsx` (누구나 push 가능, `*`) |
| 새 env var | `app/config.py` Settings, `.env.example` (ORCH PR) |
| 새 dep | `INFRA-NNN-add-<dep>` issue + 합의 (거의 안 함) |

### 3.5 중간 점검 (45분 시점)

issue가 1.5시간 이상 걸릴 것 같으면:

```
"45분 지났습니다. acceptance criteria 중 60% 이상 끝났나요?
- YES → 계속 진행, 30분 더
- NO → issue를 더 작게 쪼개야 할 수 있어요. hk-slice로 돌아갈까요?"
```

### 3.6 Done-defining: Acceptance 자가 검증 (10분)

구현이 끝나면, **issue의 `## Acceptance`** 각 줄을 본인 앞에서 실행 (curl, browser, DB):

```bash
# 예시: API 200 + row 생성
curl -X POST http://localhost:8000/api/foo -H "Content-Type: application/json" -d '{...}'
sqlite3 backend/app.db 'SELECT * FROM calls ORDER BY started_at DESC LIMIT 3;'
```

모두 [x] 가 될 때까지.

### 3.7 Verify checklist 작성 (5분)

`templates/verify-checklist.md`을 copy해서 본인 issue에 attach:

```bash
# VERIFY.md는 본인 issue 경로가 아닌 docs/slices/<id>/VERIFY.md에 둠
# 또는 issue 본문에 ## Verify 섹션으로 추가 (gh에서는 labels로도 가능)
mkdir -p docs/slices/QUEUE-001
cp docs/templates/verify-checklist.md docs/slices/QUEUE-001/VERIFY.md
# A섹션은 본인이 채움, B섹션은 issue acceptance에서 복사
git add docs/slices/QUEUE-001/VERIFY.md
git commit -m "docs(QUEUE-001): add VERIFY.md"
```

### 3.8 Push (pre-push hook이 자동 체크) (1분)

```bash
git add .
git commit -m "feat(QUEUE-001): add outbound table component"
git push -u origin HEAD
```

`pre-push` hook이:
- 변경 파일이 본인 모듈인지 검증
- OK면 push 진행
- 위반이면 **push block** + 에러 메시지

**block되면**: hook 출력 보고 위반 파일 revert. 다른 모듈 파일이 필요했던 거면 PR로 분리.

### 3.9 PR 생성 (1분)

```bash
gh pr create \
  --title "[QUEUE] add outbound table component" \
  --body-file docs/templates/pr.md \
  --base main \
  --reviewer <reviewer>
```

- title 형식: `[<MODULE>] <short desc>` (대상 모듈 명시)
- reviewer: 자기 모듈이면 아무나, 다른 모듈이면 그 owner
- `--base main` 명시

### 3.10 Issue status 갱신

```bash
gh issue edit <num> --remove-label "status:in-progress" --add-label "status:in-review"
```

### 3.11 Hand-off 메시지

```
✅ QUEUE-001 구현 완료
- 변경: 3 files (모두 QUEUE 모듈)
- hook check: PASS
- PR: #42 [QUEUE] add outbound table component
- Reviewer: @personB (1h 내 부탁)

본인 issue: status:in-review
다른 사람 PR이 떠 있으면 빨리 머지 부탁드립니다 (1h SLA).
```

---

## 4. 출력 / Output

- **새/수정된 파일** (모두 본인 모듈 안)
- **`docs/slices/<id>/VERIFY.md`** 작성
- **PR** (#번호, in-review 라벨)
- **Issue** status: in-review
- **본인 브랜치**는 머지 후 자동 cleanup (`gh pr merge --delete-branch`)

---

## 5. 가드레일 / Guardrails

- ❌ **`pre-push` hook 우회 (`--no-verify`) 절대 금지.** 24h에 자동화가 안전.
- ❌ **본인 모듈 외 파일 edit** (issue의 Shared files에도 없으면).
- ❌ **TEAM LOCK 파일** (tailwind.config, package.json 등) edit — PR 필요.
- ❌ **Schema 변경** (WS message, API contract) — ORCH PR, 합의.
- ❌ **새 dep 추가** — `INFRA-NNN` issue 합의.
- ❌ **plan 없이 바로 코드 작성 금지** (3.3 통과 필수).
- ❌ **acceptance criteria 일부만 채우고 "done" 금지** (100% 또는 fail).
- ❌ **VERIFY.md 없이 hand-off 금지**.
- ✅ **30분마다 한 줄 progress** ("30분: step 2/4 끝").
- ✅ **다른 사람 PR이 떠있으면 본인 작업 양보** (`docs/WORKFLOW.md` §3.3).

---

## 6. 자주 만나는 함정

| 함정 | 증상 | 해결 |
|---|---|---|
| **hook이 push를 막음** | "violation: <file> owned by PHONE" | 그 파일 revert. PR로 분리. |
| **다른 사람 PR 머지 안 됨** | 본인 모듈 파일이 그 PR에 영향 | 1시간 SLA 기다리거나 음성 ping. |
| **rebase conflict** | 본인이 작업 중 누가 main에 push | `git rebase origin/main`, 충돌 해결 후 `--force-with-lease` (NOT `--force`) |
| **schema 변경 필요** | issue acceptance에 없었는데 필요해짐 | issue 새로 만들기 (`ORCH-NNN-...`), 본인 issue에 "blocked by" 추가 |
| **TEAM LOCK 파일 변경** | tailwind.config 등 | `INFRA-NNN-...` issue 합의, 본인 issue는 close (변경 불필요) |
| **lint FAIL** | tsc / ruff error | 고치고 push. 모듈 boundary와 무관. |
| **WS 메시지 안 옴** | type mismatch | `STACK.md` §5 schema + 본인 코드 비교. snake_case/camelCase. |
| **CORS error** | frontend에서 backend 호출 실패 | `app/main.py` `CORSMiddleware(allow_origins=["http://localhost:3000"])` |

---

## 7. 다음 단계로 / Hand-off

**조건**:
- [ ] Issue의 `## Acceptance` 모든 항목 [x]
- [ ] `pnpm tsc --noEmit` 0 errors (FE인 경우)
- [ ] `ruff check backend/` 0 errors (BE인 경우)
- [ ] `docs/slices/<id>/VERIFY.md` 작성됨
- [ ] `pre-push` hook 통과
- [ ] PR 생성됨, reviewer 지정됨
- [ ] Issue status: in-review

**다음**: 본인 PR이 머지되기를 기다리면서, 다음 issue pick 또는 다른 사람 PR 리뷰.

PR 머지 후 (`gh pr merge --squash --delete-branch`):
- `gh issue close <num> --comment "done in #<pr>"`
- `git checkout main && git pull`
- 다음 issue → 3.1부터
