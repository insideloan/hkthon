# MODULES — 모듈 경계 정의 / Module Boundaries

> **5 modules, 5 people, 1 hub.** 이 문서가 파일 ownership의 SSOT입니다.
> 24시간 동안 본 문서를 기준으로 충돌을 판단합니다.

> **⚠️ SSOT 경고**: 본 문서 안의 ` ```yaml` 블록 (`<!-- @hk modules-yaml:start -->` ~ `<!-- @hk modules-yaml:end -->`)이 **자동 파싱의 SSOT**입니다. 사람용 표는 그 yaml을 사람이 읽기 좋게 표현한 것. **Drift 발견 시** `./install.sh --verify-modules` 실행.

---

## 1. 모듈 목록 / Module List

| 코드 | 이름 | Owner (1명) | 한 줄 정의 |
|---|---|---|---|
| **QUEUE** | Outbound Call Queue | Person A | 상담원이 보는 고객 queue + 색상 변화 |
| **PHONE** | Customer iPhone UI | Person B | 고객이 받는 화면 + 발화 캡처 |
| **CALL** | Agent Call View | Person C | 통화 중 화면: 그래프/트랜스크립트/페르소나/승인 |
| **SUMMARY** | Handoff Summary | Person D | 통화 종료 후 AI 인계 요약 생성/표시 |
| **ORCH** | Orchestrator Hub | Person E | LangGraph agent, LLM router, STT/TTS bridge, WS broadcast |

> **1인 1모듈 (5명)**: 4명 시절엔 CALL+SUMMARY를 한 owner가 맡았으나, 5명이 되면서 CALL(Person C)과 SUMMARY(Person D)를 분리. 통화 화면 → 인계 요약 화면 UI 일관성은 두 owner가 협의로 유지.

---

## 2. File Ownership Matrix

> ✅ = 본인이 직접 push 가능 (자기 모듈)
> 🔒 = PR 필수 (다른 모듈 파일)
> 🚫 = TEAM LOCK (합의 필수, 거의 안 건드림)
> `*` = shared (누구나 push 가능, e.g. UI wrapper)

> **⚙️ 자동 SSOT**: 아래 yaml 블록이 `scripts/check-module-boundary.py`가 읽는 단일 진실 공급원입니다.
> yaml을 수정하면 사람용 표도 같이 수정해야 합니다 (`./install.sh --verify-modules`로 drift 검사).

<!-- @hk modules-yaml:start -->
```yaml
# This YAML block is the SSOT for the module boundary check.
# Edit this section when adding/removing files. Then run
#   ./install.sh --verify-modules
# to ensure the human-readable tables below match.
#
# Paths are RELATIVE TO REPO ROOT (matches the human-readable tables).
# Glob syntax is fnmatch: `*` matches any path segment, `**` is also `*` here.
# (We use fnmatch, not true recursive `**` — `backend/app/llm/*` matches
# `backend/app/llm/router.py` but not `backend/app/llm/prompts/foo.txt`.
# If you need a subtree, list each path explicitly.)

# Special owners (NOT a real module — handled specially in check):
#   "*"          = shared (anyone can write; e.g. UI wrappers, OWNER.md, tests)
#   "TEAM-LOCK"  = requires all-team approval (deps, configs, MODULES.md itself)

modules:
  - code: QUEUE
    name: Outbound Call Queue
    owner_person: Person A
    files:
      - backend/app/models/customer.py
      - backend/app/api/queue.py
      - backend/app/ws/agent_ws.py
      - frontend/src/app/page.tsx
      - frontend/src/components/queue/*
      - frontend/src/stores/queueStore.ts

  - code: PHONE
    name: Customer iPhone UI
    owner_person: Person B
    files:
      - backend/app/ws/customer_ws.py
      - backend/app/models/transcript.py
      - frontend/src/app/phone/page.tsx
      - frontend/src/components/phone/*
      - frontend/src/lib/mic.ts

  - code: CALL
    name: Agent Call View
    owner_person: Person C
    files:
      - backend/app/models/call.py
      - backend/app/models/product.py
      - backend/app/api/calls.py
      - frontend/src/app/call/[id]/page.tsx
      - frontend/src/components/call/CallGraph.tsx
      - frontend/src/components/call/TranscriptPanel.tsx
      - frontend/src/components/call/GuidancePanel.tsx
      - frontend/src/components/call/PersonaCard.tsx
      - frontend/src/components/call/ProductApproval.tsx
      - frontend/src/stores/callStore.ts
      - frontend/src/types/call.ts
      - frontend/src/types/customer.ts
      - frontend/src/types/transcript.ts

  - code: SUMMARY
    name: Handoff Summary
    owner_person: Person D
    files:
      - backend/app/models/summary.py
      - backend/app/api/summaries.py
      - frontend/src/components/call/SummaryPanel.tsx
      - frontend/src/types/summary.ts

  - code: ORCH
    name: Orchestrator Hub
    owner_person: Person E
    files:
      - backend/app/main.py
      - backend/app/config.py
      - backend/app/db.py
      - backend/app/models/scenario_run.py
      - backend/app/scenarios/*
      - backend/app/agent/*
      - backend/app/llm/router.py
      - backend/app/llm/bedrock.py
      - backend/app/llm/openai_compat.py
      - backend/app/llm/prompts/*
      - backend/app/stt/*
      - backend/app/tts/*
      - backend/app/seed.py
      - backend/pyproject.toml
      - backend/uv.lock
      - backend/.env.example
      - frontend/src/lib/api.ts
      - frontend/src/lib/ws.ts
      - frontend/src/types/ws.ts

  # Shared: anyone can write. Wrappers, OWNER.md, slice docs, tests, etc.
  - code: SHARED
    name: Shared (any module owner)
    owner_person: anyone
    files:
      - backend/app/tests/*
      - frontend/src/components/ui/*
      - OWNER.md
      - docs/slices/*
      - docs/templates/*
      - .github/ISSUE_TEMPLATE/*
      - .github/PULL_REQUEST_TEMPLATE.md
      - .githooks/*
      - backend/scripts/*
      - .gitignore
      - README.md

  # TEAM-LOCK: requires all-team approval. The pre-push hook blocks
  # any individual push that touches these.
  - code: TEAM-LOCK
    name: Team Lock (all-team approval required)
    owner_person: all
    files:
      - frontend/tailwind.config.ts
      - frontend/package.json
      - frontend/pnpm-lock.yaml
      - docs/MODULES.md
      - docs/WORKFLOW.md
      - docs/reference/*
```
<!-- @hk modules-yaml:end -->

> **이 yaml을 수정하면**:
> 1. 위 사람용 표 (§2.1, §2.2)도 같이 갱신
> 2. `./install.sh --verify-modules` 실행해서 drift 검사
> 3. PR로 팀원 합의

### 2.1 Backend (`backend/`)

| Path | QUEUE | PHONE | CALL | SUMMARY | ORCH |
|---|:---:|:---:|:---:|:---:|:---:|
| `backend/app/main.py` | 🔒 | 🔒 | 🔒 | 🔒 | ✅ |
| `backend/app/config.py` | 🚫 | 🚫 | 🚫 | 🚫 | ✅ |
| `backend/app/db.py` | 🔒 | 🔒 | 🔒 | 🔒 | ✅ |
| `backend/app/models/customer.py` | ✅ | 🔒 | 🔒 | 🔒 | 🔒 |
| `backend/app/models/call.py` | ✅ | 🔒 | ✅ | ✅ | 🔒 |
| `backend/app/models/transcript.py` | 🔒 | ✅ | ✅ | 🔒 | 🔒 |
| `backend/app/models/summary.py` | 🔒 | 🔒 | 🔒 | ✅ | 🔒 |
| `backend/app/models/product.py` | 🔒 | 🔒 | ✅ | 🔒 | 🔒 |
| `backend/app/models/scenario_run.py` | 🔒 | 🔒 | 🔒 | 🔒 | ✅ |
| `backend/app/api/queue.py` | ✅ | 🔒 | 🔒 | 🔒 | 🔒 |
| `backend/app/api/calls.py` | 🔒 | 🔒 | ✅ | 🔒 | 🔒 |
| `backend/app/api/summaries.py` | 🔒 | 🔒 | 🔒 | ✅ | 🔒 |
| `backend/app/ws/agent_ws.py` | ✅ | 🔒 | 🔒 | 🔒 | 🔒 |
| `backend/app/ws/customer_ws.py` | 🔒 | ✅ | 🔒 | 🔒 | 🔒 |
| `backend/app/scenarios/*` | 🔒 | 🔒 | 🔒 | 🔒 | ✅ |
| `backend/app/agent/*` | 🔒 | 🔒 | 🔒 | 🔒 | ✅ |
| `backend/app/llm/router.py` | 🔒 | 🔒 | 🔒 | 🔒 | ✅ |
| `backend/app/llm/bedrock.py` | 🔒 | 🔒 | 🔒 | 🔒 | ✅ |
| `backend/app/llm/openai_compat.py` | 🔒 | 🔒 | 🔒 | 🔒 | ✅ |
| `backend/app/llm/prompts/*` | 🔒 | 🔒 | 🔒 | 🔒 | ✅ |
| `backend/app/stt/*` | 🔒 | 🔒 | 🔒 | 🔒 | ✅ |
| `backend/app/tts/*` | 🔒 | 🔒 | 🔒 | 🔒 | ✅ |
| `backend/app/seed.py` | 🚫 | 🚫 | 🚫 | 🚫 | ✅ |
| `backend/pyproject.toml` | 🚫 | 🚫 | 🚫 | 🚫 | ✅ (의존성 추가만 PR) |
| `backend/uv.lock` | 🚫 | 🚫 | 🚫 | 🚫 | ✅ |
| `backend/.env.example` | 🚫 | 🚫 | 🚫 | 🚫 | ✅ |
| `backend/app/tests/*` | ✅ | ✅ | ✅ | ✅ | ✅ (각자 자기 모듈 테스트) |

### 2.2 Frontend (`frontend/src/`)

| Path | QUEUE | PHONE | CALL | SUMMARY | ORCH |
|---|:---:|:---:|:---:|:---:|:---:|
| `frontend/src/app/page.tsx` | ✅ | 🔒 | 🔒 | 🔒 | 🚫 |
| `frontend/src/app/call/[id]/page.tsx` | 🔒 | 🔒 | ✅ | 🔒 | 🚫 |
| `frontend/src/app/phone/page.tsx` | 🔒 | ✅ | 🔒 | 🔒 | 🚫 |
| `frontend/src/components/queue/*` | ✅ | 🔒 | 🔒 | 🔒 | 🚫 |
| `frontend/src/components/phone/*` | 🔒 | ✅ | 🔒 | 🔒 | 🚫 |
| `frontend/src/components/call/CallGraph.tsx` | 🔒 | 🔒 | ✅ | 🔒 | 🚫 |
| `frontend/src/components/call/TranscriptPanel.tsx` | 🔒 | 🔒 | ✅ | 🔒 | 🚫 |
| `frontend/src/components/call/GuidancePanel.tsx` | 🔒 | 🔒 | ✅ | 🔒 | 🚫 |
| `frontend/src/components/call/PersonaCard.tsx` | 🔒 | 🔒 | ✅ | 🔒 | 🚫 |
| `frontend/src/components/call/ProductApproval.tsx` | 🔒 | 🔒 | ✅ | 🔒 | 🚫 |
| `frontend/src/components/call/SummaryPanel.tsx` | 🔒 | 🔒 | 🔒 | ✅ | 🚫 |
| `frontend/src/components/ui/*` | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
| `frontend/src/lib/api.ts` | 🚫 | 🚫 | 🚫 | 🚫 | ✅ |
| `frontend/src/lib/ws.ts` | 🚫 | 🚫 | 🚫 | 🚫 | ✅ |
| `frontend/src/lib/mic.ts` | 🔒 | ✅ | 🔒 | 🔒 | 🚫 |
| `frontend/src/stores/queueStore.ts` | ✅ | 🔒 | 🔒 | 🔒 | 🚫 |
| `frontend/src/stores/callStore.ts` | 🔒 | 🔒 | ✅ | 🔒 | 🚫 |
| `frontend/src/types/call.ts` | 🔒 | 🔒 | ✅ | 🔒 | 🚫 |
| `frontend/src/types/customer.ts` | 🔒 | 🔒 | ✅ | 🔒 | 🚫 |
| `frontend/src/types/transcript.ts` | 🔒 | 🔒 | ✅ | 🔒 | 🚫 |
| `frontend/src/types/summary.ts` | 🔒 | 🔒 | 🔒 | ✅ | 🚫 |
| `frontend/src/types/ws.ts` | 🔒 | 🔒 | 🔒 | 🔒 | ✅ |
| `frontend/tailwind.config.ts` | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
| `frontend/package.json` | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |

### 2.3 Repo-level (TEAM LOCK)

| Path | 규칙 |
|---|---|
| `frontend/package.json`, `frontend/pnpm-lock.yaml` | 새 의존성 추가 시 PR (WORKFLOW.md §4) |
| `backend/pyproject.toml`, `backend/uv.lock` | 새 의존성 추가 시 PR |
| `frontend/tailwind.config.ts` | wrapper 교체 / queue 색상 변경 시 PR |
| `docs/reference/*` (ARCHITECTURE/STACK/CONVENTIONS/PRODUCT-BRIEF) | 합의 후 PR |
| `OWNER.md` | 모듈 owner 누구든 push 가능 (status 갱신) |
| `docs/MODULES.md` (이 파일) | 합의 후 PR (오프라인 합의 → 누군가 PR) |
| `docs/WORKFLOW.md` | 합의 후 PR |

> **TEAM LOCK 파일은** 누가 작성해도 PR. 본인이 push 못 함 (maintainer도 PR 권장).

---

## 3. 모듈 ↔ 사람 매핑 / Module ↔ Person

```
Person A  ──► QUEUE  (frontend + backend of queue)
Person B  ──► PHONE  (frontend + ws of customer)
Person C  ──► CALL   (agent call view)
Person D  ──► SUMMARY (handoff summary)
Person E  ──► ORCH   (orchestrator + state machine + integrations)
```

**1인 1모듈**. 본인이 owner인 모듈 안에서는 자유 push. 다른 모듈은 PR.

---

## 4. PR 워크플로우 / PR Workflow

### 4.1 PR을 만들어야 하는 경우

1. 다른 사람 모듈의 파일을 변경해야 할 때
2. TEAM LOCK 파일을 건드릴 때
3. wire-format (WS 메시지 schema, REST API schema)을 바꿀 때 (schema는 ORCH가 관리하므로 ORCH에 PR)
4. 새 dependency를 추가할 때

### 4.2 PR 타이틀 규약

```
[<target-module>] <short description>
```

예:
- `[ORCH] add state machine for S1 happy path`
- `[QUEUE] color queue row on S1 signup event`
- `[ORCH] add /api/calls/approve endpoint (used by CALL)`
- `[TEAM-LOCK] add @tanstack/react-query to package.json`

### 4.3 PR 본문

`templates/pr.md` 사용. 다음을 명시:
- **Why**: 무엇 때문에?
- **What**: 무엇을 변경?
- **Affected modules**: 어느 모듈에 영향? (특히 schema 변경 시)
- **Test plan**: 어떻게 검증?
- **Related issue**: `MODULE-NNN`

### 4.4 리뷰어 / 머지 권한

- **Reviewer**: 1명 이상 (대상 모듈 owner가 reviewer)
- **Self-merge 금지**: 본인이 만든 PR은 본인이 merge 못 함
- **긴급 시**: "🚨 URGENT" 라벨 + 슬랙/음성으로 팀에 알림

### 4.5 머지 컨플릭트 방지 / Merge Conflict Prevention

> **핵심 규칙**: PR이 떠 있으면 **같은 파일을 작업하기 전에** 그 PR을 먼저 머지.

| 상황 | 행동 |
|---|---|
| 본인이 모듈 A 작업 중, 모듈 B에서 PR이 올라옴 | PR을 보고 본인 모듈에 영향 있으면 일시정지, 그 PR을 먼저 머지 |
| 본인이 모듈 A push했는데 main에 모듈 B의 새 commit | 본인이 직접 rebase → push, 충돌 시 모듈 B owner에게 음성으로 알림 |
| 모듈 B가 본인이 push 중인 파일을 변경하는 PR | 음성으로 모듈 B owner에게 알림, **둘 중 한 명이 일시정지** |
| schema 변경 PR (ORCH) | ORCH PR이 머지된 **후에** 다른 모듈이 자기 코드를 update + push |

**상세 머지 프로토콜**: `WORKFLOW.md` §3 참고.

---

## 5. 모듈 간 인터페이스 / Inter-Module Interfaces

> **인터페이스는 ORCH가 정의하고 broadcast.** 한 쪽이 임의로 변경하면 PR + 다른 모듈에 사전 통보.

### 5.1 REST API (ORCH가 정의, 다른 모듈은 consumer)

| Endpoint | 모듈 (정의) | 모듈 (사용) |
|---|---|---|
| `POST /api/calls/start` | ORCH | QUEUE |
| `GET /api/queue` | QUEUE | QUEUE (본인) |
| `POST /api/calls/{id}/approve` | ORCH | CALL |
| `POST /api/summaries` | SUMMARY | SUMMARY (본인), ORCH (콜백) |
| `GET /api/customers/{id}` | ORCH | CALL |

**API 변경은 ORCH PR.** 본인이 endpoint 추가하려면 ORCH에 PR.

### 5.2 WebSocket 메시지 (ORCH가 정의, schema는 `frontend/src/types/ws.ts` + `backend/app/ws/*.py`)

| 메시지 | 정의 | 사용 |
|---|---|---|
| `{type: "queue_update"}` | QUEUE | QUEUE |
| `{type: "call_started"}` | ORCH | PHONE, CALL |
| `{type: "transcript"}` | ORCH | CALL |
| `{type: "node_entered"}` | ORCH | CALL |
| `{type: "guidance"}` | ORCH | CALL |
| `{type: "fraud_flag"}` | ORCH | QUEUE, CALL |
| `{type: "call_ended"}` | ORCH | CALL, SUMMARY |
| `{type: "approve_product"}` (cmd) | CALL | ORCH |

**WS schema 변경은 ORCH PR.**

### 5.3 모듈 의존성 그래프

```
         ORCH
       /  |  \
      /   |   \
   QUEUE PHONE CALL
              |
            SUMMARY
```

- QUEUE → ORCH (start_call API, queue_update event)
- PHONE → ORCH (incoming call event, audio)
- CALL → ORCH (call state, transcript, guidance)
- SUMMARY → ORCH (call_ended trigger)
- ORCH는 모두에게 의존 (hub)

**순환 의존 없음.**

---

## 6. SSOT 운영 / Operating the SSOT

### 6.1 SSOT가 깨졌을 때 (drift 발견)

`./install.sh --verify-modules` 실행:

```bash
# hk-skills 레포에서
./install.sh --verify-modules
# 또는 hackathon 프로젝트에서
cd ~/workspace/hackathon-2026
./scripts/lint-modules.py
```

**Drift 종류**:
- yaml에 있는데 사람용 표에 없음 → yaml 기준으로 사람용 표 갱신
- 사람용 표에 있는데 yaml에 없음 → yaml에 추가 + 사람용 표는 그대로
- 사람이 yaml과 표 양쪽 모두 갱신해야 합니다. 자동 동기화는 의도적으로 안 함 (drift를 항상 사람이 확인).

### 6.2 새 파일 추가 시

1. `MODULES.md`의 `<!-- @hk modules-yaml:start -->` 안 yaml 블록에 파일 추가
2. 위 사람용 표 (§2.1 또는 §2.2)도 같은 셀에 ✅ 표시 추가
3. `./install.sh --verify-modules` 실행해서 일치 확인
4. PR (TEAM LOCK이므로 모든 팀원 approve)

### 6.3 새 모듈 추가 시

24h 안에 새 모듈 추가는 거의 없지만, 구조 변경이 필요하면:
1. `MODULES.md` §1 모듈 목록 + §2 yaml 양쪽 갱신
2. `OWNER.md` Modules 테이블 갱신
3. `setup-project.sh`는 한 번 실행된 프로젝트에 영향 없음 (이미 init됨)
4. PR (TEAM LOCK)

---

## 7. Pre-push hook (자동 강제) / Auto enforcement

`setup-project.sh`가 다음 hook을 설치:

```bash
# .git/hooks/pre-push
# 변경 파일 목록을 가져와서 모듈 boundary check
# 본인이 모듈 A owner인데 모듈 B 파일이 변경되었으면 push block
```

`scripts/parse-modules.py`가 `MODULES.md`를 파싱 → `OWNERSHIP` dict 생성 → `check-module-boundary.py`가 그걸 import.

**훅 무시하지 마세요.** 해커톤 시간 압박이 클수록 자동 강제가 안전합니다. 우회하려면 `# bypass` 커밋 메시지 + 팀 합의 (24h에는 거의 없음).

---

## 8. 모듈 변경 시 / When you need to change another module

```
"이 파일은 내 모듈이 아닌데, OO 때문에 꼭 바꿔야 해."

1. owner에게 음성/메신저로 알림
2. owner가 직접 push 가능하면 → owner에게 요청
3. owner가 막혀있거나 불가하면 → 본인이 PR
   - PR title: [<원래-owner-module>] <설명>
   - reviewer로 원래 owner 지정
4. PR 머지까지 본인은 다른 모듈 파일 대기
5. 머지된 후 본인 모듈 작업 재개
```

**절대 하지 말 것**:
- ❌ pre-push hook 우회 (`git push --no-verify` 금지)
- ❌ 다른 owner에게 "PR 올렸으니 빨리 머지해" 압박 (24h엔 의도적 압박은 ok, 하지만 머지 우선순위는 PR 올린 사람 + owner 합의로)
- ❌ 동시에 여러 모듈 파일 변경 (작은 PR로 쪼개기)

---

## 9. FAQ

**Q. CALL과 SUMMARY가 owner가 다른데, SUMMARY 변경 시 CALL도 같이 영향 받으면?**
A. CALL(Person C)과 SUMMARY(Person D)는 별도 모듈. 한쪽이 다른 쪽 파일을 바꿔야 하면 PR + 음성 협의. call_ended → summary 생성 트리거 같은 인터페이스는 ORCH가 정의 (§5.2).

**Q. ORCH가 CALL에 있는 컴포넌트를 import해야 하면?**
A. ORCH는 backend만, CALL은 frontend만. 어차피 layer가 다름. 만약 둘이 backend에서 공통 모듈을 써야 하면 → `app/common/` 같은 새 디렉토리 + 새 모듈로 분리하거나 ORCH가 include.

**Q. UI wrapper (Button.tsx 등)를 누가 관리?**
A. 누구든 push 가능. wrapper 변경이 다른 모듈 UI에 영향 줄 수 있으니, 큰 변경은 PR + Demo.

**Q. Owner가 갑자기 도망가면?**
A. OWNER.md에 적힌 owner가 본인이 직접 못 하면 → 다른 사람이 모듈 인수. 인수인계 PR (작음).

**Q. pre-push hook을 우회해야 할 때?**
A. 거의 없음. 정말 필요하면 owner 합의 + 모듈 boundary 명시. 우회는 항상 기록.

---

## 10. 본 문서 변경 / Updating this doc

1. `MODULES.md` 안 yaml 블록 (§2) 수정
2. 사람용 표 (§2.1, §2.2) 같이 수정
3. `./install.sh --verify-modules` 실행
4. PR (TEAM LOCK, 모든 팀원 approve)

> **Drift는 항상 사람이 확인**합니다. 자동 동기화는 의도적으로 안 함 — 그게 안전.
