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
- "이제 구현 시작" / "implement FRONTEND-001"
- "issue 끝내자"

---

## 2. 입력 / Input

- 본인 GitHub issue (`gh issue view <num>`)
- `docs/MODULES.md` §2 (file ownership matrix — **반드시 확인**)
- `reference/ARCHITECTURE.md`, `STACK.md`, `CONVENTIONS.md`
- `reference/API.md` (AppSync GraphQL 계약 — 뮤테이션/구독/쿼리 구현 시 **반드시 확인**)
- `reference/CHURN-RISK-LEXICON.md` (AGENT가 `onIndexUpdate.churnRisk` 산출 / FRONTEND가 게이지 표시 구현 시 **반드시 확인** — 점수 모델 + 키워드 사전 SSOT)
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

#### Orchestrator (Python Lambda)

- `reference/ARCHITECTURE.md` §5의 디렉토리 위치
- type hints, `logging`, DynamoDB 접근은 boto3 싱글-테이블 패턴만, 직접 SQL/관계형 DB 금지
- LLM: 에이전트 로직은 `lambda/orchestrator/agent/` (LangGraph in live mode — `graph.py` / `nodes.py` / `state.py`) 에 위치. LLM 접근은 `lambda/orchestrator/llm/router.py`를 통해 호출
- AppSync 뮤테이션/구독은 `graphql/schema.graphql`(BACKEND 소유) 계약대로 구현. resolver는 `lambda/orchestrator/resolvers/`, 핸들러 엔트리는 `handler.py`. 구현 후 AppSync 콘솔/`aws appsync get-introspection-schema` 또는 `graphql/schema.graphql`와 대조
- AppSync 구독(`onTurn`/`onIndexUpdate`/...) — schema는 `graphql/schema.graphql`, 값 산출은 DynamoDB write→Streams 팬아웃
- 이탈위험도(`onIndexUpdate.churnRisk` / `analysis.churnRisk`): **AGENT**가 산출자. `lambda/orchestrator/agent/churn_risk.py`(AGENT 소유)가 `data/lexicon/churn_risk_lexicon.json`을 로드해 `reference/CHURN-RISK-LEXICON.md` §1 점수 모델(baseline 50, 가중치 합산, EMA α=0.6, 부정/강조 처리)대로 계산 → 매 고객 턴 후 `onIndexUpdate` 방출. 고객 STT(`speaker: customer`) 발화에만 적용. **FRONTEND**는 `onIndexUpdate`를 구독해 우상단 게이지를 표시(소비자, 점수 계산 안 함)

#### Frontend (TypeScript/Next.js)

- `src/components/<area>/<Name>.tsx`
- wrapper `src/components/ui/*` 통해서 (`CONVENTIONS.md` §6.1)
- inline `style={{}}` 금지
- `any` 금지, 모든 함수에 타입
- AppSync 구독: `lib/appsync.ts` 통해서 (`Amplify generateClient().subscribe()`)
- AppSync 뮤테이션/쿼리: `lib/appsync.ts` 통해서

#### 자주 쓰는 패턴

| 상황 | 패턴 |
|---|---|
| 새 GraphQL 필드 | `graphql/schema.graphql`에 타입/필드 + `lambda/orchestrator/resolvers/<thing>.py` |
| 새 DynamoDB 엔터티 | `lambda/orchestrator/models/<thing>.py` (boto3 마샬링), 싱글 테이블 PK/SK |
| 새 구독 | `graphql/schema.graphql` 필드 + AGENT가 DynamoDB write → Streams 팬아웃 |
| 이탈위험도 점수 (churn_risk) | AGENT: `lambda/orchestrator/agent/churn_risk.py`가 `data/lexicon/churn_risk_lexicon.json` 로드 → `reference/CHURN-RISK-LEXICON.md` §1 모델대로 계산 → `onIndexUpdate` 방출. FRONTEND은 그 구독을 소비만. 사전 수정은 `reference/`의 .md+.json 동시 변경 |
| 새 Frontend 페이지 | `src/app/<route>/page.tsx` |
| 새 wrapper | `src/components/ui/<Name>.tsx` (누구나 push 가능, `*`) |
| 새 env var | Secrets Manager + `infra/` CDK (CLOUD 소유). `.env.example`에 키 이름만 기록 |
| 새 dep | `lambda/orchestrator/requirements.txt` 또는 `frontend/package.json` (CLOUD PR 필요) |

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
# 예시: AppSync 뮤테이션 호출 + DynamoDB 확인
curl -X POST https://<api-id>.appsync-api.<region>.amazonaws.com/graphql \
  -H "Content-Type: application/json" \
  -H "x-api-key: <appsync-api-key>" \
  -d '{"query":"mutation { nextTurn(callId: \"<callId>\") { seq speaker text } }"}'

aws dynamodb query \
  --table-name <table> \
  --key-condition-expression "PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"CALL#<callId>"}}' \
  --query "Items[*]"
```

모두 [x] 가 될 때까지.

### 3.7 Verify checklist 작성 (5분)

`templates/verify-checklist.md`을 copy해서 본인 issue에 attach:

```bash
# VERIFY.md는 본인 issue 경로가 아닌 docs/slices/<id>/VERIFY.md에 둠
# 또는 issue 본문에 ## Verify 섹션으로 추가 (gh에서는 labels로도 가능)
mkdir -p docs/slices/FRONTEND-001
cp docs/templates/verify-checklist.md docs/slices/FRONTEND-001/VERIFY.md
# A섹션은 본인이 채움, B섹션은 issue acceptance에서 복사
git add docs/slices/FRONTEND-001/VERIFY.md
git commit -m "docs(FRONTEND-001): add VERIFY.md"
```

### 3.8 Push (pre-push hook이 자동 체크) (1분)

```bash
git add .
git commit -m "feat(FRONTEND-001): add outbound table component"
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
  --title "[FRONTEND] add outbound table component" \
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
✅ FRONTEND-001 구현 완료
- 변경: 3 files (모두 FRONTEND 모듈)
- hook check: PASS
- PR: #42 [FRONTEND] add outbound table component
- Reviewer: @jusil (1h 내 부탁)

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
- ❌ **Schema 변경** (GraphQL 스키마/구독 계약) — BACKEND PR, 합의.
- ❌ **이탈위험도 사전을 코드에 하드코딩 금지** — 키워드/가중치는 `reference/CHURN-RISK-LEXICON.md`(prose) + `reference/churn_risk_lexicon.json`(code)을 **동시** 수정. `data/lexicon/churn_risk_lexicon.json`은 S3 배포본이며 reference가 SSOT.
- ❌ **새 dep 추가** — `CLOUD-NNN` issue 합의.
- ❌ **plan 없이 바로 코드 작성 금지** (3.3 통과 필수).
- ❌ **acceptance criteria 일부만 채우고 "done" 금지** (100% 또는 fail).
- ❌ **VERIFY.md 없이 hand-off 금지**.
- ✅ **30분마다 한 줄 progress** ("30분: step 2/4 끝").
- ✅ **다른 사람 PR이 떠있으면 본인 작업 양보** (`docs/WORKFLOW.md` §3.3).

---

## 6. 자주 만나는 함정

| 함정 | 증상 | 해결 |
|---|---|---|
| **hook이 push를 막음** | "violation: <file> owned by BACKEND" | 그 파일 revert. PR로 분리. |
| **다른 사람 PR 머지 안 됨** | 본인 모듈 파일이 그 PR에 영향 | 1시간 SLA 기다리거나 음성 ping. |
| **rebase conflict** | 본인이 작업 중 누가 main에 push | `git rebase origin/main`, 충돌 해결 후 `--force-with-lease` (NOT `--force`) |
| **schema 변경 필요** | issue acceptance에 없었는데 필요해짐 | issue 새로 만들기 (`BACKEND-NNN-...`), 본인 issue에 "blocked by" 추가 |
| **TEAM LOCK 파일 변경** | tailwind.config 등 | `CLOUD-NNN-...` issue 합의, 본인 issue는 close (변경 불필요) |
| **lint FAIL** | tsc / ruff error | 고치고 push. 모듈 boundary와 무관. |
| **구독 이벤트 안 옴** | DynamoDB write 누락 또는 Streams 미설정 | Lambda orchestrator 로그 확인 → DynamoDB write → Streams → AppSync 팬아웃 경로 점검 |
| **AppSync 401/403** | API 키 누락 또는 만료 | `x-api-key` 헤더 확인, CDK 출력에서 키 재확인 |

---

## 7. 다음 단계로 / Hand-off

**조건**:
- [ ] Issue의 `## Acceptance` 모든 항목 [x]
- [ ] `pnpm tsc --noEmit` 0 errors (FE인 경우)
- [ ] `ruff check lambda/orchestrator/` 0 errors (BE인 경우)
- [ ] `docs/slices/<id>/VERIFY.md` 작성됨
- [ ] `pre-push` hook 통과
- [ ] PR 생성됨, reviewer 지정됨
- [ ] Issue status: in-review

**다음**: 본인 PR이 머지되기를 기다리면서, 다음 issue pick 또는 다른 사람 PR 리뷰.

PR 머지 후 (`gh pr merge --squash --delete-branch`):
- `gh issue close <num> --comment "done in #<pr>"`
- `git checkout main && git pull`
- 다음 issue → 3.1부터
