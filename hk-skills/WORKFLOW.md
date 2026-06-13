# WORKFLOW — 이슈 + PR + 머지 프로토콜 / Issue, PR & Merge Protocol

> **본 문서는 팀 전체의 진행 흐름을 정의합니다.**
> 24시간 동안 본 문서를 기준으로 issue 추적, PR 흐름, 머지 우선순위를 결정합니다.

---

## 1. Issue Workflow

### 1.1 Issue = 작업 1건

> **하나의 issue = 한 사람이 끝낼 수 있는 한 task.**
> 슬라이스보다 작아도 되고, 슬라이스와 1:1이어도 됩니다.

Issue를 너무 크게 만들면 (예: "FE 통화 화면 완성") 진행이 안 보임. 작게 (예: "CallGraph에 노드 추가 API 연결") 자주 commit + 자주 close.

### 1.2 Title 규약 / Title format

```
<MODULE>-<NNN>-<short-kebab-desc>
```

- **MODULE**: `QUEUE` | `PHONE` | `CALL` | `MEMO` | `ORCH` | `INFRA` (TEAM LOCK)
- **NNN**: 3자리 zero-padded (001, 002, ...)
- **short-kebab-desc**: 영문 kebab-case, 30자 이내

예:
- `QUEUE-001-outbound-table-component`
- `PHONE-002-incoming-call-screen`
- `CALL-001-callgraph-render-nodes`
- `MEMO-001-memo-popup-with-llm-draft`
- `ORCH-001-state-machine-skeleton`
- `INFRA-001-add-shadcn-dep`

### 1.3 Issue 본문 / Issue body

`templates/issue.md`을 copy해서 사용. 다음 섹션:

```markdown
## Why / 왜 필요한가
- <한 문단>

## What / 무엇을
- [ ] <체크박스 1>
- [ ] <체크박스 2>
- [ ] <체크박스 3>

## Affected modules / 영향 모듈
- <QUEUE | PHONE | CALL | MEMO | ORCH> - <어떻게 영향?>

## Acceptance / 완료 기준
- [ ] <체크박스: 측정 가능>
- [ ] <체크박스: 측정 가능>

## Module / 모듈
<QUEUE | PHONE | CALL | MEMO | ORCH | INFRA>

## Estimate / 예상 시간
<Nh>
```

### 1.4 Issue 상태 (GitHub Projects 또는 라벨로) / Issue states

| 라벨 | 색 | 의미 |
|---|---|---|
| `status:backlog` | 회색 | 아직 안 시작, 우선순위 정해짐 |
| `status:ready` | 보라 | 자기 모듈 + 자기 이슈 + 본 PR 안 한 상태 |
| `status:in-progress` | 노랑 | 한 사람이 작업 중 (1인 1이슈 원칙) |
| `status:in-review` | 파랑 | PR 올림, 리뷰/머지 대기 |
| `status:done` | 초록 | 머지 완료 + verify 통과 |
| `status:blocked` | 빨강 | 다른 issue가 끝나야 시작 가능 (이슈 본문에 명시) |
| `priority:p0` | 빨강 | minimal demo 필수 |
| `priority:p1` | 주황 | good demo, 시간 있으면 |
| `priority:p2` | 노랑 | polish |

### 1.5 1인 1이슈 / One person, one in-progress issue

> **같은 사람이 `status:in-progress` issue를 동시에 2개 이상 가지지 않기.**

이유: 24h에 context switching = disaster. 한 이슈 끝내고 다음.

**단, 예외**: 1시간 이내로 끝나는 trivial 이슈 (예: `ORCH-005 fix typo in log`)는 in-progress 1개 + trivial 1개 허용.

### 1.6 Issue → PR → Close

```
status:backlog → status:ready → status:in-progress (자기 assign)
                                  ↓
                              작업 (commit은 자유)
                                  ↓
                              PR (status:in-review)
                                  ↓
                              리뷰 + 머지 → status:done (close)
```

> **PR이 머지되면 issue는 `status:done` 라벨 + close.** 본인이 직접.

---

## 2. Branch 전략 / Branch Strategy

### 2.1 메인 / Main

- `main` — 항상 로컬에서 실행 가능. **누구나 pull 받으면 1-command 실행 가능**해야 함.
- 직접 push 안 함. **PR로만 머지.**

### 2.2 작업 브랜치 / Working branch

```
<MODULE>-<issue-num>-<short-desc>
```

예:
- `QUEUE-001-outbound-table`
- `PHONE-002-incoming-screen`
- `ORCH-001-state-machine-skeleton`

브랜치는 자기 모듈 안에서 자유롭게 push. **다른 모듈 변경 PR도 같은 사람의 작업 브랜치에서** 떴다가 머지되면 그 사람이 새 브랜치 시작.

### 2.3 main ↔ 본인 브랜치 동기화

```bash
# 본인 브랜치에 main의 새 commit 반영 (rebase)
git fetch origin
git rebase origin/main
# 충돌 시 해결
git push --force-with-lease  # (rebase 후 force push는 OK. --force는 위험, --force-with-lease 사용)
```

> **24h에는 rebase 권장.** 머지 커밋이 쌓이면 history가 지저분해지고 충돌 추적이 어려움.

### 2.4 충돌 시 / When you hit a conflict

**Option 1 (90% 케이스)**: 본인이 직접 rebase하면서 해결. 충돌 파일이 본인 모듈이면 → OK. 다른 모듈이면 → 그 모듈 owner에게 음성 알림 후 일시정지.

**Option 2 (드묾)**: 모듈 owner와 둘이 화면 공유로 한 번에 해결.

**Option 3 (절대 안 됨)**: `--force` 또는 `--no-verify`로 무시 push → main 망가짐. **금지.**

---

## 3. PR 머지 프로토콜 / PR Merge Protocol

### 3.1 누가 머지하나 / Who merges

| PR 종류 | Reviewer | Merger |
|---|---|---|
| 자기 모듈 변경 | (옵션) 팀원 1명 approve | **본인** 가능 (모듈 boundary OK면) |
| 다른 모듈 변경 | **그 모듈 owner 1명 approve 필수** | 그 owner가 merge (또는 본인이 그 owner에게 merge 요청) |
| TEAM LOCK (의존성, MODULES.md, WORKFLOW.md 등) | **모든 팀원 approve** | 본인이 merge |
| Schema 변경 (WS 메시지, API contract) | **ORCH owner + 사용 모듈 owner 2명** | ORCH owner |

> **Self-merge 허용 범위**: 자기 모듈 + 1명 approve. 단, **TEAM LOCK과 schema 변경은 본인 merge 금지** (다른 사람이 merge).

### 3.2 머지 우선순위 / Merge Priority

> **핵심**: PR이 떠 있으면 **같은 파일 작업하기 전에 머지 먼저.**

| 상황 | 우선순위 | 이유 |
|---|---|---|
| **PR이 `status:in-review`인데 본인이 그 파일 작업 중** | **PR 머지 먼저** (또는 그 owner에게 음성) | 안 그러면 conflict |
| **본인 PR이 `in-review`인데 다른 사람이 같은 파일 작업** | **본인 PR 머지 우선** | 본인이 일시정지 |
| **TEAM LOCK PR (의존성, 설정)** | **높음** (15분 내 처리) | 다른 모듈이 막힐 수 있음 |
| **Schema PR (ORCH)** | **높음** | 다른 모듈이 update 후 push해야 함 |
| **일반 모듈 PR** | 보통 (1시간 내) | |

**SLA**: PR이 떴을 때 응답 시간
- 일반 PR: **1시간 이내** approve 또는 request changes
- TEAMLOCK / schema PR: **30분 이내**
- urgent 라벨: **즉시** (5분)

> **24h에 1시간이 길다.** 가능한 한 30분 안에 처리. 음성/메신저로 ping 권장.

### 3.3 머지 컨플릭트 매트릭스 / Conflict Matrix

| 본인이 작업 중 | 상대방이 PR | 행동 |
|---|---|---|
| 모듈 A | 모듈 A PR | → PR 머지 → 본인 rebase. 충돌 시 음성 알림 |
| 모듈 A | 모듈 B PR (모듈 A 파일 일부 수정) | → **본인 일시정지, PR 머지 대기** |
| 모듈 A | ORCH schema PR (모듈 A 사용) | → **ORCH PR 머지 후 본인 모듈 update** |
| main에 push됨 | 본인 브랜치에 동일 파일 변경 | → `git fetch && git rebase origin/main` |
| 다른 사람이 본인의 main에 push | 본인도 main에 push | → **먼저 한 사람이 push, 다른 한 명 rebase** (조율) |

**모든 케이스의 공통**: 음성/메신저로 알림 → 머지 우선순위 합의.

### 3.4 머지 명령 / Merge command

```bash
# PR 로컬에서 테스트 (CI 없으므로 본인이 직접)
git fetch origin
git checkout <pr-branch>
# 또는
git fetch origin pull/<num>/head:<pr-branch>
git checkout <pr-branch>
# lint + test + smoke
cd backend && ruff check . && python -m app.smoke
cd frontend && pnpm tsc --noEmit && pnpm lint

# OK면 GitHub UI에서 "Squash and merge" (권장)
# 또는 CLI:
gh pr merge <num> --squash --delete-branch
```

**Squash merge** 권장. 24h에 history가 깨끗.

### 3.5 머지 후 / After merge

```bash
# 본인의 다른 브랜치 작업 중이었다면
git fetch origin
git rebase origin/main
# 새 main 기준으로 재작업 (충돌 해결)
```

그리고 본인 issue의 status: `in-review` → `done` + close.

---

## 4. 의존성 추가 (TEAM LOCK) / Adding Dependencies

**해커톤 중 의존성 추가는 9/10 위험.** 정말 필요할 때만.

1. issue 생성: `INFRA-NNN-add-<dep>`
2. 본문: **왜 STACK.md에 있는 것들로 안 되는지** + **추가하지 않으면 24h 안에 못 끝나는 이유**
3. 모든 팀원 approve (TEAM LOCK PR은 모두 approve)
4. 머지 후:
   - `reference/STACK.md` §2/§3에 dep 추가
   - `pyproject.toml` 또는 `package.json`에 dep 추가
   - `pnpm-lock.yaml` 또는 `uv.lock` 갱신
5. issue close

**24h에 흔한 함정**:
- "이거 하나 더 깔면 깔끔할 텐데" → ❌ 추가 안 함
- "이 템플릿이 OO 컴포넌트 있어서" → ❌ wrapper만 차용, dep 추가 안 함
- "테스트 도구가 없어서" → ❌ `print()` 디버깅으로 충분

---

## 5. 일일 흐름 / Daily flow (24h)

### 5.1 Day 0 — Setup (오프라인 또는 해커톤 시작 1시간)

1. 4명 모두 repo clone + `install.sh`
2. **모듈 확정** (MODULES.md 그대로 따름) — 이미 정해졌으면 skip
3. **GitHub repo 만들기** + 4명 모두 collaborator 추가
4. **GitHub Project** 만들기 (status 컬럼: Backlog/Ready/In Progress/In Review/Done)
5. **Issue templates** 등록 (`.github/ISSUE_TEMPLATE/hk-task.md`)
6. **`setup-project.sh`** 실행 (pre-push hook 설치, git config, owner 등록)
7. **각자 `hk-vision` + `hk-onboard`** (이미 했다면 PASS 확인)

### 5.2 Day 0 — Plan (1-2시간)

1. **`/hk-backlog`** — 4명 함께, feature backlog 작성
2. **이슈 생성** — 각 feature를 issue로 분해. 예: 8개 feature → 16-24 issue
3. **이슈 분류**: P0/P1/P2 라벨, 모듈 라벨
4. **GitHub Project에 등록**
5. **status:backlog** → 각자 자기 모듈 issue는 **status:ready**로

### 5.3 Day 0-1 — Build (18-20시간, 핵심)

루프:

```
1. 본인 status:ready issue 1개 pick
2. status:ready → status:in-progress
3. branch 생성: <MODULE>-<NNN>-<desc>
4. 구현 (commit 자유, pre-push hook이 모듈 boundary 자동 체크)
5. push → PR 생성
6. status:in-progress → status:in-review
7. reviewer 지정 (자기 모듈이면 아무나, 다른 모듈이면 그 owner)
8. reviewer approve + 머지 (우선순위 매트릭스대로)
9. 본인 브랜치 rebase
10. issue close (status:done)
11. 다음 issue
```

**4명이 동시에** 위 루프. 머지 컨플릭트 매트릭스 §3.3 적용.

**시간 압박 시**:
- 12h 시점: P0 이슈 중 done이 50% 미만이면 → P1/P2 모두 close
- 18h 시점: P0 이슈 100% + 통합 시작
- 20h 시점: P1 작업은 시간 남는 사람만
- 22h 시점: P2 close, 통합 + 데모 리허설
- 23-24h: `hk-demo` + 발표

### 5.4 Day 1 — Demo (2-4시간)

1. 22h: 통합 테스트 (모든 P0 흐름 1번)
2. 23h: `/hk-demo` — 4분 데모 시나리오 + 리허설
3. 24h: 발표

---

## 6. Status Board / 현황판

**GitHub Project 보드 권장**. 4명이 한눈에:
- 누가 무엇을 하고 있는지
- PR이 어디까지 진행됐는지
- 막힌 issue는 무엇인지

또는 단순히 GitHub Issues 라벨로도 충분 (Project 보드 없이도).

**핵심**: 24h에 "지금 누가 뭐 하고 있지?"가 1초 안에 보여야 함.

---

## 7. 메타 규칙 / Meta rules

### 7.1 음성/메신저 우선

> **24h에 비동기 텍스트는 느리다.** 머지 충돌, schema 변경 등 **동기 의사소통이 필요할 때는 음성/통화/대면**.

- PR이 떠서 머지 우선순위 헷갈리면 → 음성 30초
- Schema 변경 합의 → 음성 5분
- 새 dependency → 음성 10분 (텍스트로 합의해도 되지만 음성이 빠름)

### 7.2 한 명은 항상 "통합 monitor" / Integration monitor

> 4명 중 1명은 30분마다 한 번 **main을 pull + 통합 smoke test**:
> 1. `git pull origin main`
> 2. `cd backend && ruff check . && python -m app.smoke`
> 3. `cd frontend && pnpm tsc --noEmit && pnpm lint`
> 4. backend + frontend 실행 후 `/` 페이지 응답 200 확인

이걸 잊으면 **24h 끝에 "main이 안 돌아가"** disaster. 역할 분담:
- 모니터 1명: 통합 smoke (예: ORCH owner 또는 순환)
- 모니터 1명: PR queue 관리 (1시간마다 Slack에 PR 현황)

또는 4명 모두 자기 브랜치 push 전 lint + smoke 책임.

### 7.3 1시간 sync (선택) / Hourly sync

24h에 1번 1시간 단위 standup은 너무 자주. 하지만 4-6시간 단위 "지금 뭐 하고 있어?" sync는 가치 있음:
- 0h, 6h, 12h, 18h, 22h — 각 5분

각자 30초: "OO 이슈 진행 중, 막힌 거 없음" / "PR 올림, reviewer 부탁".

---

## 8. Anti-patterns (24h에 절대 안 됨) / Anti-patterns

❌ **pre-push hook 우회 (`--no-verify`)**: 본 문서 + git history에 흔적. 24h엔 자동화가 안전.
❌ **main에 직접 push**: PR로만.
❌ **긴 시간 머지 안 하기 (1시간+)**: 다른 사람 막힘. SLA 지킬 것.
❌ **충돌 무시하고 둘 다 push → 둘 다 망가짐**: 충돌 발견 시 즉시 일시정지.
❌ **자기 issue 외에 작업**: 1인 1이슈 (in-progress). trivial은 예외.
❌ **TEAM LOCK 파일 합의 없이 push**: PR + 모두 approve.
❌ **Schema 변경 합의 없이 push**: ORCH에 PR + 사용 모듈 owner 합의.
❌ **새 dep 추가 합의 없이 push**: 9/10 위험. 본 문서 §4 프로세스 따르기.
❌ **테스트 안 짜고 push**: 적어도 smoke (lint + build + curl 200) 정도는 본인 브랜치에서 통과.

---

## 9. Quick reference

| 상황 | 명령 |
|---|---|
| Issue 만들기 | `gh issue create --title "QUEUE-001-..." --body-file templates/issue.md --label "status:ready,module:queue"` |
| Issue assign + status 변경 | `gh issue edit <num> --add-assignee @me --remove-label "status:ready" --add-label "status:in-progress"` |
| 작업 시작 | `git fetch && git checkout -b QUEUE-001-...` |
| PR 만들기 | `git push -u origin HEAD && gh pr create --title "[QUEUE] ..." --body-file templates/pr.md --reviewer <person>` |
| PR 머지 | `gh pr merge <num> --squash --delete-branch` |
| main 동기화 | `git fetch && git rebase origin/main` |
| Issue close | `gh issue close <num> --comment "done in #<pr>"` |

---

## 10. 본 문서 변경 / Updating this doc

- 모든 팀원 합의 후 PR
- 실전에서 명백히 안 맞는 부분 발견되면 즉시 갱신 (24h에 doc은 살아있는 것)
