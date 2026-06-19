# MODULES — 모듈 경계 정의 / Module Boundaries

> **5 modules, 5 people (역할/계층 기반).** 이 문서가 파일 ownership의 SSOT입니다.
> 24시간 동안 본 문서를 기준으로 충돌을 판단합니다.
> AWS Cloud 환경 전환에 맞춰 기능 기반(QUEUE/PHONE/CALL/SUMMARY/ORCH)에서 **역할/계층 기반**으로 재편.

> **⚠️ SSOT 경고**: 본 문서 안의 ` ```yaml` 블록 (`<!-- @hk modules-yaml:start -->` ~ `<!-- @hk modules-yaml:end -->`)이 **자동 파싱의 SSOT**입니다. 사람용 표는 그 yaml을 사람이 읽기 좋게 표현한 것. **Drift 발견 시** `./install.sh --verify-modules` 실행.

---

## 1. 모듈 목록 / Module List

| 코드 | 이름 | Owner (1명) | 한 줄 정의 |
|---|---|---|---|
| **CLOUD** | Cloud · CI · PR 관리 | 일조 | AWS 배포/인프라, CI 파이프라인, 의존성·설정, PR 게이트키핑 |
| **DATA** | Data | 수민 | 데이터 모델, 시드, 시나리오 데이터 |
| **AGENT** | Agent | 은경 | LangGraph agent, LLM router, STT/TTS bridge, 이탈위험도(churn) |
| **BACKEND** | Backend | 지원 | REST API, WebSocket, 앱 코어(main/config/db) |
| **FRONTEND** | Frontend | 주실 | Next.js 화면 전체(관리자/통화/요약 UI) |

> **역할/계층 기반 재편**: AWS Cloud 환경으로 개발 환경이 바뀌며 기능 모듈(QUEUE/PHONE/CALL/SUMMARY/ORCH)을 폐지하고 계층 역할로 분리. 고객 iPhone UI는 제거(단일 상담원 화면 + 노트북 마이크/스피커 음성 채널)되어 별도 PHONE 모듈 없음.
> **1인 1모듈 (5명)**: CLOUD(일조)는 TEAM-LOCK 파일·PR을 관장하는 허브 역할도 겸한다.

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
  - code: DATA
    name: Data (models · seed · scenarios)
    owner_person: 수민
    files:
      - backend/app/models/*
      - backend/app/seed.py
      - backend/app/scenarios/*

  - code: AGENT
    name: Agent (LangGraph · LLM · STT/TTS · churn risk)
    owner_person: 은경
    files:
      - backend/app/agent/*
      # churn_risk_lexicon.json (이탈위험도 키워드 사전, reference/에서 복사) 도 app/agent/* 에 포함
      - backend/app/llm/*
      - backend/app/stt/*
      - backend/app/tts/*

  - code: BACKEND
    name: Backend (API · WS · app core)
    owner_person: 지원
    files:
      - backend/app/main.py
      - backend/app/config.py
      - backend/app/db.py
      - backend/app/api/*
      - backend/app/ws/*

  - code: FRONTEND
    name: Frontend (Next.js 전체)
    owner_person: 주실
    files:
      - frontend/src/app/*
      - frontend/src/components/queue/*
      - frontend/src/components/call/*
      - frontend/src/stores/*
      - frontend/src/types/*
      - frontend/src/lib/api.ts
      - frontend/src/lib/ws.ts
      - frontend/src/lib/mic.ts

  - code: CLOUD
    name: Cloud (배포 · CI · 의존성/설정 · PR 관리)
    owner_person: 일조
    files:
      - backend/pyproject.toml
      - backend/uv.lock
      - backend/.env.example
      - frontend/package.json
      - frontend/pnpm-lock.yaml
      - frontend/tailwind.config.ts
      - frontend/next.config.mjs
      - infra/*
      - .github/workflows/*

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
  # any individual push that touches these. CLOUD(일조)가 PR을 관장.
  - code: TEAM-LOCK
    name: Team Lock (all-team approval required)
    owner_person: all
    files:
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

> 컬럼: DATA(수민) · AGENT(은경) · BACKEND(지원) · FRONTEND(주실) · CLOUD(일조)

| Path | DATA | AGENT | BACKEND | FRONTEND | CLOUD |
|---|:---:|:---:|:---:|:---:|:---:|
| `backend/app/main.py` | 🔒 | 🔒 | ✅ | 🔒 | 🔒 |
| `backend/app/config.py` | 🔒 | 🔒 | ✅ | 🔒 | 🔒 |
| `backend/app/db.py` | 🔒 | 🔒 | ✅ | 🔒 | 🔒 |
| `backend/app/models/*` | ✅ | 🔒 | 🔒 | 🔒 | 🔒 |
| `backend/app/seed.py` | ✅ | 🔒 | 🔒 | 🔒 | 🔒 |
| `backend/app/scenarios/*` | ✅ | 🔒 | 🔒 | 🔒 | 🔒 |
| `backend/app/agent/*` | 🔒 | ✅ | 🔒 | 🔒 | 🔒 |
| `backend/app/llm/*` | 🔒 | ✅ | 🔒 | 🔒 | 🔒 |
| `backend/app/stt/*` | 🔒 | ✅ | 🔒 | 🔒 | 🔒 |
| `backend/app/tts/*` | 🔒 | ✅ | 🔒 | 🔒 | 🔒 |
| `backend/app/api/*` | 🔒 | 🔒 | ✅ | 🔒 | 🔒 |
| `backend/app/ws/*` | 🔒 | 🔒 | ✅ | 🔒 | 🔒 |
| `backend/pyproject.toml` | 🚫 | 🚫 | 🚫 | 🚫 | ✅ (의존성 PR) |
| `backend/uv.lock` | 🚫 | 🚫 | 🚫 | 🚫 | ✅ |
| `backend/.env.example` | 🚫 | 🚫 | 🚫 | 🚫 | ✅ |
| `backend/app/tests/*` | ✅ | ✅ | ✅ | ✅ | ✅ (각자 자기 모듈 테스트) |

### 2.2 Frontend (`frontend/src/`)

| Path | DATA | AGENT | BACKEND | FRONTEND | CLOUD |
|---|:---:|:---:|:---:|:---:|:---:|
| `frontend/src/app/*` | 🔒 | 🔒 | 🔒 | ✅ | 🔒 |
| `frontend/src/components/queue/*` | 🔒 | 🔒 | 🔒 | ✅ | 🔒 |
| `frontend/src/components/call/*` | 🔒 | 🔒 | 🔒 | ✅ | 🔒 |
| `frontend/src/components/ui/*` | 🔒 | 🔒 | 🔒 | ✅ | 🔒 |
| `frontend/src/lib/api.ts` | 🔒 | 🔒 | 🔒 | ✅ | 🔒 |
| `frontend/src/lib/ws.ts` | 🔒 | 🔒 | 🔒 | ✅ | 🔒 |
| `frontend/src/lib/mic.ts` | 🔒 | 🔒 | 🔒 | ✅ | 🔒 |
| `frontend/src/stores/*` | 🔒 | 🔒 | 🔒 | ✅ | 🔒 |
| `frontend/src/types/*` | 🔒 | 🔒 | 🔒 | ✅ | 🔒 |
| `frontend/tailwind.config.ts` | 🚫 | 🚫 | 🚫 | 🔒 | ✅ |
| `frontend/package.json` | 🚫 | 🚫 | 🚫 | 🔒 | ✅ (의존성 PR) |
| `frontend/next.config.mjs` | 🚫 | 🚫 | 🚫 | 🔒 | ✅ |

> wire-format(WS 메시지·REST 스키마)은 BACKEND가 정의하되 DATA(모델)·FRONTEND(타입)와 합의 필요 — §5 참고.

### 2.3 Cloud / Repo-level (CLOUD 관장)

| Path | 규칙 |
|---|---|
| `infra/*`, `.github/workflows/*` | AWS 배포·CI. CLOUD(일조) 소유 |
| `frontend/package.json`, `frontend/pnpm-lock.yaml` | 새 의존성 추가 시 PR → CLOUD 리뷰 |
| `backend/pyproject.toml`, `backend/uv.lock` | 새 의존성 추가 시 PR → CLOUD 리뷰 |
| `frontend/tailwind.config.ts`, `frontend/next.config.mjs` | 설정 변경 시 PR → CLOUD 리뷰 |
| `docs/reference/*` (ARCHITECTURE/STACK/CONVENTIONS/PRODUCT-BRIEF/CHURN-RISK-LEXICON + churn_risk_lexicon.json) | 합의 후 PR |
| `OWNER.md` | 모듈 owner 누구든 push 가능 (status 갱신) |
| `docs/MODULES.md` (이 파일) | 합의 후 PR (CLOUD가 머지 관장) |
| `docs/WORKFLOW.md` | 합의 후 PR |

> **TEAM LOCK 파일은** 누가 작성해도 PR. 본인이 push 못 함 (maintainer도 PR 권장).

---

## 3. 모듈 ↔ 사람 매핑 / Module ↔ Person

```
일조  ──► CLOUD     (AWS 배포 · CI · 의존성/설정 · PR 관리)
수민  ──► DATA      (models · seed · scenarios)
은경  ──► AGENT     (LangGraph · LLM · STT/TTS · churn risk)
지원  ──► BACKEND   (REST API · WebSocket · app core)
주실  ──► FRONTEND  (Next.js 화면 전체)
```

> AWS Cloud 환경 전환으로 기능 기반 모듈을 폐지하고 역할/계층 기반으로 재편. 고객 iPhone UI 제거에 따라 오디오/STT 입력은 BACKEND(`/ws/audio`) + AGENT(STT)가 직접 수용.

**1인 1모듈**. 본인이 owner인 모듈 안에서는 자유 push. 다른 모듈은 PR. CLOUD(일조)는 TEAM-LOCK·PR 머지를 관장.

---

## 4. PR 워크플로우 / PR Workflow

### 4.1 PR을 만들어야 하는 경우

1. 다른 사람 모듈의 파일을 변경해야 할 때
2. TEAM LOCK 파일을 건드릴 때 (CLOUD가 머지 관장)
3. wire-format (WS 메시지 schema, REST API schema)을 바꿀 때 (schema는 BACKEND가 관리 → BACKEND에 PR, DATA/FRONTEND 합의)
4. 새 dependency를 추가할 때 (CLOUD 리뷰)

### 4.2 PR 타이틀 규약

```
[<target-module>] <short description>
```

예:
- `[AGENT] add state machine for S1 happy path`
- `[FRONTEND] color queue row on S1 signup event`
- `[BACKEND] add /api/calls/approve endpoint (used by FRONTEND)`
- `[CLOUD] add @tanstack/react-query to package.json`

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
| schema 변경 PR (BACKEND) | BACKEND PR이 머지된 **후에** DATA/FRONTEND가 자기 코드를 update + push |

**상세 머지 프로토콜**: `WORKFLOW.md` §3 참고.

---

## 5. 모듈 간 인터페이스 / Inter-Module Interfaces

> **wire-format(REST/WS)은 BACKEND가 정의·broadcast.** 데이터 모양은 DATA(모델)와, 클라이언트 타입은 FRONTEND와 합의. AGENT는 분석/발화 이벤트의 페이로드를 채운다. 한 쪽이 임의로 변경하면 PR + 다른 모듈에 사전 통보.

### 5.1 REST API (BACKEND가 정의, 다른 모듈은 consumer)

| Endpoint | 모듈 (정의) | 모듈 (사용) |
|---|---|---|
| `POST /api/calls/start` | BACKEND | FRONTEND ("통화" 버튼) |
| `GET /api/queue` | BACKEND | FRONTEND |
| `POST /api/calls/{id}/approve` | BACKEND | FRONTEND |
| `POST /api/summaries` | BACKEND | FRONTEND, AGENT (요약 생성 콜백) |
| `GET /api/customers/{id}` | BACKEND | FRONTEND |

**API 변경은 BACKEND PR.** 응답 스키마(모델)는 DATA와 합의.

### 5.2 WebSocket 메시지 (BACKEND가 채널 정의, schema는 `frontend/src/types/ws.ts` + `backend/app/ws/*.py`)

| 메시지 | 페이로드 생산 | 사용 |
|---|---|---|
| `{type: "queue_update"}` | BACKEND | FRONTEND |
| `{type: "call_started"}` | BACKEND | FRONTEND |
| `{type: "transcript"}` | AGENT (STT) → BACKEND | FRONTEND |
| `{type: "node_entered"}` | AGENT | FRONTEND |
| `{type: "index_update"}` (churn_risk/emotion) | AGENT | FRONTEND |
| `{type: "guidance"}` | AGENT | FRONTEND |
| `{type: "ai_action"}` | AGENT | FRONTEND |
| `{type: "fraud_flag"}` | AGENT | FRONTEND |
| `{type: "call_ended"}` | BACKEND | FRONTEND |
| `{type: "approve_product"}` (cmd) | FRONTEND | BACKEND |
| `{type: "audio_chunk" / "audio_out"}` (`/ws/audio`) | FRONTEND ↔ AGENT(STT/TTS) | BACKEND 중계 |

**WS schema 변경은 BACKEND PR.** 분석 이벤트(`index_update`/`guidance`/`ai_action`)의 의미·값은 AGENT가 정의.

> `index_update.churn_risk`(이탈위험도)는 AGENT의 `app/agent/churn_risk.py`가 키워드 사전(`app/agent/churn_risk_lexicon.json`)으로 계산해 방출합니다. 점수 모델/키워드/가중치 SSOT는 `reference/CHURN-RISK-LEXICON.md` (+ machine-readable `reference/churn_risk_lexicon.json`). 사전 변경은 두 파일 동시 수정 → AGENT PR.

### 5.3 모듈 의존성 그래프 (계층)

```
   CLOUD (배포·CI·의존성·PR 게이트 — 전 계층 가로지름)
     │
  FRONTEND ──► BACKEND ──► AGENT
                  │           │
                  └────► DATA ◄┘
```

- FRONTEND → BACKEND (REST/WS consume)
- BACKEND → AGENT (턴 실행 호출), BACKEND → DATA (모델/영속)
- AGENT → DATA (모델·시나리오·시드 읽기)
- CLOUD는 코드 계층에 직접 의존하지 않지만 배포·CI·의존성·PR을 관장(횡단).

**순환 의존 없음.** (오디오/STT 입력은 PHONE 폐지로 BACKEND `/ws/audio` + AGENT STT가 직접 수용.)

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

**Q. 화면(통화/요약)이 한 모듈(FRONTEND)인데 owner 한 명이 다 감당 가능?**
A. FRONTEND(주실)가 화면 전체를 소유. 통화 화면 ↔ 요약 화면 일관성은 한 owner라 오히려 쉬움. 백엔드 데이터가 필요하면 BACKEND/DATA와 §5 인터페이스로 협의.

**Q. BACKEND가 AGENT의 함수를 호출해야 하면?**
A. 둘 다 backend 계층. BACKEND(`api`/`ws`)가 AGENT(`agent.run_turn` 등)를 import해 호출하는 건 정상 의존(§5.3). 시그니처 변경은 AGENT PR + BACKEND 통보.

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
