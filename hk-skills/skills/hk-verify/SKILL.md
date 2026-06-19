---
name: hk-verify
description: hk-implement가 끝난 issue를 비개발자가 검증. VERIFY.md 체크 + PR 리뷰 코멘트. PASS면 머지, FAIL이면 hk-implement 회귀.
---

# hk-verify — Issue 검증 + PR 리뷰 / Verify an Issue

> **목적 / Purpose**: 본인 PR을 자기 자신이 (또는 reviewer가) 검증. 비개발자도 가능. PASS면 머지, FAIL이면 같은 issue로 hk-implement 회귀.
> Verify your own PR or as a reviewer. Non-dev friendly. PASS → merge. FAIL → back to hk-implement.

> **24h에 두 가지 verify**:
> 1. **Self-verify** (본인): PR 올리기 전, 본인 코드가 acceptance를 만족하는지
> 2. **Reviewer verify** (남): PR이 떠 있으면 1h SLA 안에 검증

---

## 1. 언제 쓰나 / When to use

- 본인이 `hk-implement` 끝내고 PR 올리기 직전 (self-verify)
- 본인이 reviewer로 지정된 PR이 올라왔을 때 (reviewer-verify)
- 1h 머지 SLA 안에 처리 (`docs/WORKFLOW.md` §3.2)

**트리거**:
- "PR 올리기 전 확인" / "이 PR 괜찮은지 봐줘"
- "이 PR 리뷰" / "review FRONTEND-001"

---

## 2. 입력 / Input

- `docs/slices/<id>/VERIFY.md` (hk-implement가 채워둠)
- `reference/API.md` (REST/WS 스펙 — 응답/메시지 schema 대조용)
- `reference/CHURN-RISK-LEXICON.md` (이탈위험도 검증 시 — §5 worked example을 골든 케이스로 사용)
- 본인이 reviewer인 GitHub PR (#번호)
- 본인 환경: backend + frontend 실행 중

---

## 3. 진행 / Process

### 3.1 환경 확인 (1분)

```bash
cd ~/workspace/hackathon-2026
git checkout main && git pull
cd backend && uv run uvicorn app.main:app --port 8000 &
cd frontend && pnpm dev &
```

브라우저 `http://localhost:3000` 정상 응답.

### 3.2 모듈 boundary 확인 (PR만, 1분)

reviewer라면 PR의 changed files를 보고:
- 그 파일들이 **PR author의 모듈**에 속하는지 (`docs/MODULES.md` §2)
- TEAM LOCK 파일이 포함되어 있으면 → 추가 검증 (모든 팀원 합의 있었는지)
- 모듈 위반이면 → `request changes` + 어떤 파일이 어느 모듈에 속하는지 명시

**Pre-push hook이 이미 검증했지만**, reviewer가 한 번 더 보는 게 안전.

### 3.3 VERIFY.md A섹션 — 자동 검증 (2분, 본인 + reviewer)

```bash
cd backend && ruff check app/             # 0 errors
cd backend && mypy app/                   # 0 errors (optional)
cd frontend && pnpm tsc --noEmit          # 0 errors
cd frontend && pnpm lint                  # 0 errors
cd backend && python -m app.db_init && python -m app.seed  # OK
```

### 3.4 VERIFY.md B섹션 — 수용 기준 (5-10분)

Issue의 `## Acceptance` 각 항목을 **실제로 실행**해서 확인.

| Issue type | 확인 방법 |
|---|---|
| Backend (API) | `curl -X POST .../api/foo` 200 + JSON (`reference/API.md` §1 schema와 일치) |
| Backend (DB) | `duckdb backend/app.duckdb 'SELECT ...'` |
| Backend (WS) | `wscat -c ws://...` + frontend에서 trigger |
| Frontend | 브라우저에서 본인 페이지 클릭 |
| Both | 위 둘 다 |

각 항목을 **본인이 직접** 체크. "Claude가 대신 해줄까요?" → 거절. **사용자가 직접 보는 게 verify의 의미.**

### 3.5 VERIFY.md C섹션 — 시각적 (FE only, 3-5분)

브라우저에서:
- 빈 상태, 로딩, 성공, 에러, 반응형 (1280×800)
- 색상 / 한국어 라벨 자연스러움

### 3.6 VERIFY.md D섹션 — WebSocket (해당 시, 3분)

- Chrome DevTools → Network → WS → 메시지 payload 확인
- `reference/API.md` §2 + `STACK.md` §5 schema와 일치 (type, snake_case, field 다 있음)
- 이탈위험도(`index_update.churn_risk`) 검증: `reference/CHURN-RISK-LEXICON.md` §5의 worked example 발화를 순서대로 입력 → churn_risk 궤적이 문서 값(±2)과 일치하는지. 사전 기반이라 같은 입력은 같은 점수여야 함(결정적).

### 3.7 VERIFY.md E섹션 — LLM (해당 시, 5분)

- 같은 입력으로 3번 실행
- 3/3 JSON parse 성공
- 한국어 자연스러움
- **Bedrock 연결 확인**: `.env`의 AWS 자격증명/리전으로 `ChatBedrockConverse` 호출 성공 (Bedrock 전용, provider 전환 없음)

### 3.8 VERIFY.md F섹션 — 외부 API (해당 시, 2분)

- `.env` git에 안 들어갔는지
- API key 없을 때 graceful 에러

### 3.9 VERIFY.md G섹션 — 데모 가능성 (3분)

> "이 issue가 끝나면 데모에서 한 단계 진전했나?"

- 메인 데모 시나리오(S1 happy path 우선)에 이 issue가 들어가는가
- 다른 사람 issue와 충돌 없는가 (수동 통합)

### 3.10 결과 결정

**모든 섹션 [x] → PASS**
**하나라도 [ ] → FAIL**

#### Self-verify 결과 (본인 PR 올리기 전)

PASS인 경우: 3.10 → `gh pr create` (hk-implement §3.9로)
FAIL인 경우: 3.10 → `gh issue edit <num> --remove-label "status:in-review" --add-label "status:in-progress"` → hk-implement로 회귀

#### Reviewer-verify 결과 (남의 PR)

PASS인 경우:
```bash
gh pr review <num> --approve
gh pr merge <num> --squash --delete-branch
```

(또는 UI에서 approve + merge. 본인이 모듈 owner가 아니어도 본인이 merge 가능 — squash merge는 reversible.)

FAIL인 경우:
```bash
gh pr review <num> --request-changes --body "## What
- VERIFY.md B#2: API 200이지만 row 생성 안 됨 (curl 확인)
- VERIFY.md C#3: 한국어 라벨 어색 ('거절' → '거절됨' 으로)

## How to fix
- <각 항목별 fix 힌트>
"
```

그리고 issue status: in-review → in-progress (PR author가 회귀)

---

## 4. 출력 / Output

- **Self-verify**: PR 생성 또는 hk-implement 회귀
- **Reviewer-verify**: PR approve+merge 또는 request-changes
- **VERIFY.md** 결과 기록 (모든 섹션 [x] 또는 실패 표시)
- **Issue status** 자동 갱신 (in-review → done 또는 → in-progress)

---

## 5. 가드레일 / Guardrails

- ❌ **Claude가 "PASS"로 대신 결정하지 않기.** 사용자가 직접 체크.
- ❌ **자동 검증 A섹션이 FAIL인데 PASS 선언 절대 금지.**
- ❌ **모듈 boundary 위반 PR을 approve하지 않기** — `request changes`.
- ❌ **TEAM LOCK PR을 1명이 approve하고 merge하지 않기** — CLOUD(일조) + 관련 팀원 approve 필요.
- ❌ **Schema PR을 BACKEND owner + 사용 모듈(DATA/FRONTEND) owner approve 없이 merge하지 않기.**
- ❌ **1h 머지 SLA 넘기지 않기** — 본인 PR이 다른 사람 막고 있을 수 있음.
- ✅ **FAIL 사유는 구체적으로** (line/URL/error message) — 회귀 시 즉시 fix.
- ✅ **머지 후 issue close는 PR author가** (`gh issue close <num> --comment "done in #<pr>"`).
- ✅ **머지 후 main은 항상 실행 가능** — `git pull && pnpm dev` 1-command.

---

## 6. 자주 만나는 함정

| 증상 | 가능한 원인 | 해결 |
|---|---|---|
| A섹션 tsc FAIL | shared type 변경이 다른 파일에 영향 | PR author 회귀, type fix |
| 모듈 boundary 위반 | author의 모듈 외 파일이 PR에 | request-changes, 그 파일만 revert 또는 분리 PR |
| B섹션 API 200이지만 data 이상 | schema mismatch (FE/BE) | 둘 다 fix, type 정의 통일 |
| C섹션 "한국어 어색" | 번역투 | 문구 자연스럽게 (CONVENTIONS §10) |
| D섹션 WS 메시지 안 옴 | send 코드 경로 빠짐 | backend log 확인 |
| E섹션 JSON parse 1/3 fail | LLM streaming 잘림 | prompt에 "JSON만 출력" 강조 + retry |
| G섹션 "데모에 안 들어감" | issue가 feature의 sub-step이 아님 | hk-slice로 회귀, 재분해 |
| 머지 후 main 안 돌아감 | 통합 충돌 | 즉시 fix (긴급 PR) |

---

## 7. 다음 단계로 / Hand-off

**PASS 시 (self-verify)**:
- PR 생성 → reviewer 1h SLA 대기
- 다른 사람 PR 리뷰 (남의 1h SLA 도움)

**PASS 시 (reviewer-verify)**:
- approve + merge (squash)
- PR author가 issue close + 다음 issue

**FAIL 시**:
- issue: in-review → in-progress
- PR author 본인이 `git pull --rebase` + fix
- `/hk-implement` (같은 issue)

---

## 8. 통합 단계 (모든 P0 issue done 후) / Integration Phase

본인 issue는 끝났지만, **팀 통합**이 따로 필요할 수 있음:

1. **모든 P0 issue가 done**인지 `OWNER.md` / GitHub Project 확인
2. **메인 데모 시나리오 (S1)** 풀 플로우를 **한 사람이** 처음부터 끝까지 직접 클릭
3. **충돌 발견 시**:
   - shared file 동시 edit으로 인한 conflict → git rebase
   - 데이터 형식 mismatch (BE/FE) → 둘 다 fix
4. **모든 P0 시나리오 1번씩** 통합 데모

**통합 단계 끝나면** → `/hk-demo`.
