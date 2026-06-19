---
name: hk-slice
description: BACKLOG의 feature를 GitHub issue 단위로 분해 + owner 배정 + 모듈 boundary 검증. docs/MODULES.md가 SSOT. hk-backlog 후 P0 feature마다 실행.
---

# hk-slice — Feature를 Issue로 분해 + Owner 배정 / Slice a Feature into Issues

> **목적 / Purpose**: 1-2시간짜리 **GitHub issue**로 분해해서 **5명이 동시에 작업해도 안 부딪치게** 함. 모듈 boundary의 SSOT는 `docs/MODULES.md`.
> Break a feature into 1-2h **GitHub issues** and assign owners. Module boundary SSOT: `docs/MODULES.md`.

> **24h 해커톤은 issue 단위로 움직입니다.** 1 issue = 1 PR = 1 머지. 5명이 각자 1 in-progress issue만 가지고 번갈아 가며 처리.

---

## 1. 언제 쓰나 / When to use

- `hk-backlog` 후, P0 feature마다 1회.
- 또는 P1/P2 feature를 추가하고 싶을 때.

**트리거**:
- "이 feature를 issue로 나눠줘" / "F03 시작하자"
- "누가 뭘 할지 정하자" / "assign owner"

---

## 2. 입력 / Input

- `BACKLOG.md` (필수)
- `docs/MODULES.md` (필수, file ownership matrix)
- `docs/WORKFLOW.md` (필수, 머지 프로토콜)
- `reference/API.md` (선택, slice가 endpoint/WS 메시지를 건드리면 contract 참고)
- `OWNER.md` (필수, 현재 active work)
- GitHub repo + `gh` CLI 인증 완료

---

## 3. 진행 / Process

### 3.1 사용자에게 4가지 확인 (한 번에)

1. **"어떤 feature를 issue로 나눌까요? (F0X)"**
2. **"이 feature의 owner는 누구인가요?"** (1명이 원칙)
3. **"이 feature는 어느 모듈인가요? (CLOUD/DATA/AGENT/BACKEND/FRONTEND)"**
4. **"이 feature가 끝나면 demo에서 어떤 한 단계를 보여줄 수 있나요?"**

답변 받으면 진행.

### 3.2 Issue 단위로 분해

> **24h에 slice보다 issue가 더 작은 단위입니다. Issue 1개 = 30분-2시간.**

해당 feature를 **GitHub issue 2-6개**로 분해. 각 issue 형식:

```yaml
- id: FRONTEND-001                       # <MODULE>-<NNN>-<short-desc>
  title: outbound-table-component
  module: FRONTEND
  owner: 주실
  est_h: 1.0
  files_expected:                        # 본인 모듈 안의 파일만
    - frontend/src/components/queue/OutboundQueueTable.tsx
  shared_files: []                       # PR 필요한 다른 모듈 파일 (있으면)
  deps: []                               # blocked by
  acceptance:                            # 측정 가능
    - 페이지에 row 3개 표시 (mock data)
    - 색상 분기 (yellow/green/red) 동작
```

**ID 규약** (`docs/WORKFLOW.md` §1.2):
- `<MODULE>-<NNN>-<short-kebab-desc>`
- `NNN` = 3자리 zero-padded (`001`, `002`)
- 예: `FRONTEND-001-outbound-table-component`, `AGENT-003-state-machine-s1`

### 3.3 모듈 boundary 검증 (필수) / Module boundary check

`docs/MODULES.md` §2의 matrix를 보고:

- `files_expected`의 모든 파일이 **owner의 모듈**에 속하는지
- `shared_files`가 있으면 → **PR 흐름** (`docs/WORKFLOW.md` §3) — 다른 사람 owner가 reviewer
- 본인 모듈 외 파일이 필요하면 → **다른 사람 issue로 분리**, 본인 issue에 "blocked by: #OTHER-001" 표시

### 3.4 Issue 본문 작성

`templates/issue.md`을 copy해서 각 issue마다 본문 작성.

본문에 **반드시** 포함:
- `## Why / 왜 필요한가` — user story / demo 단계
- `## What / 무엇을` — 체크박스 step
- `## Acceptance / 완료 기준` — 측정 가능
- `## Module / 모듈` — `FRONTEND` 등
- `## Files I expect to change / 변경 예정 파일`
- `## Shared files I might need to touch / 다른 모듈 파일 (PR 필요)` — 없으면 `none`

### 3.5 GitHub issue 생성 (`gh` CLI)

```bash
gh issue create \
  --title "FRONTEND-001-outbound-table-component" \
  --body-file /tmp/FRONTEND-001.md \
  --label "status:ready,module:frontend,priority:p0" \
  --assignee @me
```

라벨:
- `status:ready` — 곧 시작
- `status:backlog` — 나중에
- `module:cloud|data|agent|backend|frontend`
- `priority:p0|p1|p2`

GitHub Project가 있으면 `--project "Hackathon 2026"` 추가.

### 3.6 `OWNER.md` 갱신

`OWNER.md`의 "Active work" 테이블에 추가:

```markdown
| Issue | Title | Module | Owner | Status |
|-------|-------|--------|-------|--------|
| FRONTEND-001 | outbound-table-component | FRONTEND | 주실 | ready |
| FRONTEND-002 | queue-store-with-websocket | FRONTEND | 주실 | ready |
| AGENT-001 | state-machine-skeleton | AGENT | 은경 | ready |
```

### 3.7 합의

```
"GitHub issues N개 만들었고, OWNER.md도 갱신했습니다.
본인이 issue를 pick해서 status:ready → in-progress로 바꾸고 시작하세요.
남의 PR이 뜨면 빠르게 머지 부탁 (1h 이내)."
```

---

## 4. 출력 / Output

- **GitHub issues N개** (status:ready 라벨, 본인 모듈만)
- **`OWNER.md`** 갱신 (active work 테이블)
- (선택) GitHub Project 보드 등록

---

## 5. 가드레일 / Guardrails

- ❌ **1인당 in-progress issue 1개 이상 가지지 않기** (1인 1이슈, trivial 1시간 미만은 예외)
- ❌ **다른 사람 모듈 파일을 자기 issue의 files_expected에 넣지 않기** → 다른 사람 issue로 분리
- ❌ **TEAM LOCK 파일 (tailwind.config, package.json 등)을 feature issue에 섞지 않기** → `CLOUD-NNN` 으로 따로
- ❌ **schema 변경 (API contract, WS message)을 일반 issue에 섞지 않기** → `BACKEND-NNN` 으로 따로 만들고 다른 모듈에 "blocked by"
- ❌ **slice ID 형식 안 맞추기** (`<MODULE>-<NNN>-<short-desc>` 강제)
- ✅ **모든 issue에 `Module:` + `Files I expect to change:` 명시**
- ✅ **dependency graph는 가능한 한 fan-out** (chain A→B→C보다 동시 A,B,C)
- ✅ **pre-push hook이 자동 체크**하지만, 본 skill 단계에서 미리 막는 게 더 안전

---

## 6. 다음 단계로 / Hand-off

**조건**:
- [ ] 각 issue마다 본문 작성됨 (`templates/issue.md` 기반, 9섹션)
- [ ] OWNER.md에 본인 issue가 `ready`로 표시됨
- [ ] `gh issue create`로 모두 GitHub에 등록됨
- [ ] 사용자가 "OK" 했음

**다음 (owner 본인만)**:
- 본인 issue 1개를 `status:ready` → `status:in-progress`로
- branch 생성: `<MODULE>-<NNN>-<short-desc>` (issue 번호와 일치)
- `/hk-implement` 실행
- 끝나면 PR → 머지 (`docs/WORKFLOW.md` §3) → issue close (`status:done`)
- 다음 issue

---

## 7. Anti-pattern

❌ **issue 1개 = 슬라이스 전체** (4-6시간): 너무 큼. 쪼개기.
❌ **5명이 동시에 같은 모듈의 다른 issue**: 모듈 boundary는 OK지만 머지 충돌 가능. `OWNER.md`로 sequencing.
❌ **"이번 feature는 5명이 같이 할 거예요"**: 모듈 owner 1명 + 다른 모듈은 PR. 24h에 공동 작업은 conflict source.
