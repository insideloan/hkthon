# MODULES — 모듈 경계 정의 / Module Boundaries

> **5 modules, 5 people (역할/계층 기반).** 이 문서가 파일 ownership의 SSOT입니다.
> 24시간 동안 본 문서를 기준으로 충돌을 판단합니다.
>
> **아키텍처 SSOT**: `docs/architecture-diagram.svg` + `docs/nextjs-aws-architecture.md`
> (Amplify + AppSync + Lambda + DynamoDB + S3 라이트 서버리스). 기능 기반(QUEUE/PHONE/CALL/SUMMARY/ORCH) + FastAPI/DuckDB/WebSocket는 폐기.

> **⚠️ SSOT 경고**: 본 문서 안의 ` ```yaml` 블록 (`<!-- @hk modules-yaml:start -->` ~ `<!-- @hk modules-yaml:end -->`)이 **자동 파싱의 SSOT**입니다. 사람용 표는 그 yaml을 사람이 읽기 좋게 표현한 것. **Drift 발견 시** `./install.sh --verify-modules` 실행.

---

## 1. 모듈 목록 / Module List

| 코드 | 이름 | Owner (1명) | 한 줄 정의 (역할/계층) |
|---|---|---|---|
| **CLOUD** | AWS Infra & Delivery | 일조 (solduma) | IaC·배포·CI — Amplify/AppSync/DynamoDB/S3/Lambda/Bedrock 프로비저닝, IAM·CloudWatch, PR 게이트 |
| **DATA** | Data & Scenario | 수민 (suminjeong3170-tech) | DynamoDB 싱글테이블 엔터티·마샬링, 시드, `scenario.json`·렉시콘(S3) |
| **AGENT** | Orchestrator Logic | 은경 (jooeunkyung) | Lambda orchestrator 비즈니스 로직 — churn_risk·MOT·classify·컴플라이언스 루프, LLM/STT/TTS 브리지 |
| **BACKEND** | API Contract & Core | 지원 (cckr34) | AppSync GraphQL 스키마(wire 계약)·resolver, Lambda 핸들러 엔트리·데이터소스 글루 |
| **FRONTEND** | Next.js App | 주실 (jusilkkk) | 화면 전체(관리자/세그먼트/상담/CRM) + AppSync 클라이언트 + Zustand 스토어 |

> **역할/계층 기반 1인 1모듈.** 고객 iPhone UI 제거(단일 상담원 화면 + 노트북 마이크/스피커 음성 채널). CLOUD(일조)는 TEAM-LOCK 파일·PR을 관장하는 허브 역할도 겸한다.
> 모듈 간 인터페이스(AppSync 이벤트 계약)는 **BACKEND가 정의**하고 변경은 BACKEND PR (§5).

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
# Glob syntax is fnmatch: `*` matches any path segment (the checker treats
# `*` as `.*`, so it spans `/` too). List subtrees with a trailing `*`.
#
# Architecture: Amplify(Next.js) + AppSync(GraphQL) + Lambda(orchestrator)
#   + DynamoDB + S3 + Bedrock. (Serverless; no FastAPI/DuckDB/WebSocket.)
#
# Special owners (NOT a real module — handled specially in check):
#   "*"          = shared (anyone can write; e.g. UI wrappers, OWNER.md, tests)
#   "TEAM-LOCK"  = requires all-team approval (deps, configs, MODULES.md itself)

modules:
  - code: DATA
    name: Data & Scenario (DynamoDB models · seed · scenarios · lexicon)
    owner_person: 수민 (suminjeong3170-tech)
    files:
      - lambda/orchestrator/models/*
      - lambda/orchestrator/seed.py
      - data/scenarios/*
      - data/lexicon/*

  - code: AGENT
    name: Orchestrator Logic (churn · MOT · classify · compliance · LLM/STT/TTS)
    owner_person: 은경 (jooeunkyung)
    files:
      - lambda/orchestrator/agent/*
      - lambda/orchestrator/llm/*
      - lambda/orchestrator/stt/*
      - lambda/orchestrator/tts/*

  - code: BACKEND
    name: API Contract & Core (AppSync schema · resolvers · Lambda handler)
    owner_person: 지원 (cckr34)
    files:
      - graphql/*
      - lambda/orchestrator/handler.py
      - lambda/orchestrator/api/*
      - lambda/orchestrator/resolvers/*

  - code: FRONTEND
    name: Next.js App (관리자/세그먼트/상담/CRM + AppSync client)
    owner_person: 주실 (jusilkkk)
    files:
      - frontend/src/app/*
      - frontend/src/components/consult/*
      - frontend/src/components/queue/*
      - frontend/src/components/crm/*
      - frontend/src/stores/*
      - frontend/src/types/*
      - frontend/src/lib/appsync.ts
      - frontend/src/lib/mic.ts
      - frontend/public/*

  - code: CLOUD
    name: AWS Infra & Delivery (IaC · CI · deps/config · PR 관리)
    owner_person: 일조 (solduma)
    files:
      - infra/*
      - amplify.yml
      - frontend/next.config.mjs
      - .github/workflows/*
      - docs/cloud/*
      - docs/architecture-diagram.*
      - hk-skills/scripts/*
      - initialize.sh

  # Shared: anyone can write. Wrappers, OWNER.md, slice docs, tests, etc.
  - code: SHARED
    name: Shared (any module owner)
    owner_person: anyone
    files:
      - lambda/orchestrator/tests/*
      - frontend/src/components/ui/*
      - OWNER.md
      - docs/slices/*
      - docs/templates/*
      - .github/ISSUE_TEMPLATE/*
      - .github/PULL_REQUEST_TEMPLATE.md
      - .githooks/*
      - .gitignore
      - README.md

  # TEAM-LOCK: requires all-team approval. The pre-push hook blocks
  # any individual push that touches these. CLOUD(일조)가 PR을 관장.
  - code: TEAM-LOCK
    name: Team Lock (all-team approval required)
    owner_person: all
    files:
      - frontend/package.json
      - frontend/pnpm-lock.yaml
      - frontend/tailwind.config.ts
      - lambda/orchestrator/requirements.txt
      - infra/package.json
      - infra/cdk.json
      - docs/MODULES.md
      - docs/WORKFLOW.md
      - docs/reference/*
      - hk-skills/MODULES.md
      - hk-skills/WORKFLOW.md
      - hk-skills/reference/*
```
<!-- @hk modules-yaml:end -->

> **이 yaml을 수정하면**:
> 1. 위 사람용 표 (§2.1, §2.2)도 같이 갱신
> 2. `./install.sh --verify-modules` 실행해서 drift 검사
> 3. PR로 팀원 합의

### 2.1 Backend / Serverless (`lambda/`, `graphql/`, `data/`)

> 컬럼: DATA(수민) · AGENT(은경) · BACKEND(지원) · FRONTEND(주실) · CLOUD(일조)

| Path | DATA | AGENT | BACKEND | FRONTEND | CLOUD |
|---|:---:|:---:|:---:|:---:|:---:|
| `graphql/*` (AppSync 스키마·계약) | 🔒 | 🔒 | ✅ | 🔒 | 🔒 |
| `lambda/orchestrator/handler.py` | 🔒 | 🔒 | ✅ | 🔒 | 🔒 |
| `lambda/orchestrator/api/*` | 🔒 | 🔒 | ✅ | 🔒 | 🔒 |
| `lambda/orchestrator/resolvers/*` | 🔒 | 🔒 | ✅ | 🔒 | 🔒 |
| `lambda/orchestrator/agent/*` | 🔒 | ✅ | 🔒 | 🔒 | 🔒 |
| `lambda/orchestrator/llm/*` | 🔒 | ✅ | 🔒 | 🔒 | 🔒 |
| `lambda/orchestrator/stt/*` | 🔒 | ✅ | 🔒 | 🔒 | 🔒 |
| `lambda/orchestrator/tts/*` | 🔒 | ✅ | 🔒 | 🔒 | 🔒 |
| `lambda/orchestrator/models/*` | ✅ | 🔒 | 🔒 | 🔒 | 🔒 |
| `lambda/orchestrator/seed.py` | ✅ | 🔒 | 🔒 | 🔒 | 🔒 |
| `data/scenarios/*` (scenario.json) | ✅ | 🔒 | 🔒 | 🔒 | 🔒 |
| `data/lexicon/*` (S3 배포본) | ✅ | 🔒 | 🔒 | 🔒 | 🔒 |
| `lambda/orchestrator/requirements.txt` | 🚫 | 🚫 | 🚫 | 🚫 | ✅ (의존성 PR) |
| `lambda/orchestrator/tests/*` | ✅ | ✅ | ✅ | ✅ | ✅ (각자 자기 모듈 테스트) |

### 2.2 Frontend (`frontend/src/`)

| Path | DATA | AGENT | BACKEND | FRONTEND | CLOUD |
|---|:---:|:---:|:---:|:---:|:---:|
| `frontend/src/app/*` | 🔒 | 🔒 | 🔒 | ✅ | 🔒 |
| `frontend/src/components/consult/*` | 🔒 | 🔒 | 🔒 | ✅ | 🔒 |
| `frontend/src/components/queue/*` | 🔒 | 🔒 | 🔒 | ✅ | 🔒 |
| `frontend/src/components/crm/*` | 🔒 | 🔒 | 🔒 | ✅ | 🔒 |
| `frontend/src/components/ui/*` (wrapper) | `*` | `*` | `*` | `*` | `*` |
| `frontend/src/lib/appsync.ts` (GraphQL client) | 🔒 | 🔒 | 🔒 | ✅ | 🔒 |
| `frontend/src/lib/mic.ts` | 🔒 | 🔒 | 🔒 | ✅ | 🔒 |
| `frontend/src/stores/*` | 🔒 | 🔒 | 🔒 | ✅ | 🔒 |
| `frontend/src/types/*` | 🔒 | 🔒 | 🔒 | ✅ | 🔒 |
| `frontend/tailwind.config.ts` | 🚫 | 🚫 | 🚫 | 🔒 | ✅ |
| `frontend/package.json` | 🚫 | 🚫 | 🚫 | 🔒 | ✅ (의존성 PR) |
| `frontend/next.config.mjs` | 🚫 | 🚫 | 🚫 | 🔒 | ✅ |

> wire-format(AppSync GraphQL 스키마)은 **BACKEND가 정의**하되 DATA(모델 모양)·FRONTEND(클라 타입)와 합의 — §5 참고.

### 2.3 Cloud / Repo-level (CLOUD 관장)

| Path | 규칙 |
|---|---|
| `infra/*`, `amplify.yml`, `.github/workflows/*`, `docs/cloud/*`, `hk-skills/scripts/*`, `initialize.sh` | AWS IaC·배포·CI·운영 도구(boundary 훅/드리프트/온보딩). CLOUD(일조) 소유 |
| `frontend/package.json`, `frontend/pnpm-lock.yaml` | 새 의존성 추가 시 PR → CLOUD 리뷰 |
| `lambda/orchestrator/requirements.txt` | 새 의존성 추가 시 PR → CLOUD 리뷰 |
| `infra/package.json`, `infra/cdk.json` | CDK 의존성·설정. PR → CLOUD 리뷰 |
| `frontend/tailwind.config.ts`, `frontend/next.config.mjs` | 설정 변경 시 PR → CLOUD 리뷰 |
| `docs/reference/*` · `hk-skills/reference/*` (ARCHITECTURE/STACK/CONVENTIONS/PRODUCT-BRIEF/CHURN-RISK-LEXICON + churn_risk_lexicon.json) | 합의 후 PR |
| `OWNER.md` | 모듈 owner 누구든 push 가능 (status 갱신) |
| `docs/MODULES.md` · `hk-skills/MODULES.md` (이 파일) | 합의 후 PR (CLOUD가 머지 관장) |
| `docs/WORKFLOW.md` · `hk-skills/WORKFLOW.md` | 합의 후 PR |

> **TEAM LOCK 파일은** 누가 작성해도 PR. 본인이 push 못 함 (maintainer도 PR 권장).
> **렉시콘 주의**: 이탈위험도 키워드 사전 SSOT는 `docs/reference/CHURN-RISK-LEXICON.md`(prose) + `docs/reference/churn_risk_lexicon.json`(code). `data/lexicon/`의 S3 배포본은 SSOT를 따라가는 복사본 — 사전 변경은 reference 두 파일 동시 수정 → PR.

---

## 3. 모듈 ↔ 사람 매핑 / Module ↔ Person

```
일조 (solduma)              ──► CLOUD     (AWS IaC · 배포 · CI · 의존성/설정 · PR 관리)
수민 (suminjeong3170-tech)  ──► DATA      (DynamoDB 모델 · 시드 · 시나리오 · 렉시콘)
은경 (jooeunkyung)          ──► AGENT     (orchestrator 로직 · LLM · STT/TTS · churn)
지원 (cckr34)               ──► BACKEND   (AppSync 스키마 · resolver · Lambda 코어)
주실 (jusilkkk)             ──► FRONTEND  (Next.js 화면 전체)
```

> AppSync 서버리스로 전환. 오디오/STT 입력은 라이브 모드에서 Lambda(orchestrator)가 Transcribe로 직접 수용(AGENT 로직), 스크립트 모드는 `scenario.json` 재생.

**1인 1모듈**. 본인이 owner인 모듈 안에서는 자유 push. 다른 모듈은 PR. CLOUD(일조)는 TEAM-LOCK·PR 머지를 관장.

---

## 4. PR 워크플로우 / PR Workflow

### 4.1 PR을 만들어야 하는 경우

1. 다른 사람 모듈의 파일을 변경해야 할 때
2. TEAM LOCK 파일을 건드릴 때 (CLOUD가 머지 관장)
3. wire-format (AppSync GraphQL 스키마)을 바꿀 때 → **BACKEND에 PR**, DATA/FRONTEND 합의
4. 새 dependency를 추가할 때 (CLOUD 리뷰)

### 4.2 PR 타이틀 규약

```
[<target-module>] <short description>
```

예:
- `[AGENT] add churn_risk scorer (baseline·EMA·clamp)`
- `[FRONTEND] color speech keywords PRO=green/CONS=red`
- `[BACKEND] add onMotDetected subscription to schema`
- `[CLOUD] provision AppSync API + DynamoDB resolver`
- `[TEAM-LOCK] add aws-cdk-lib to infra deps`

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
| schema 변경 PR (BACKEND) | BACKEND PR이 머지된 **후에** DATA/FRONTEND/AGENT가 자기 코드를 update + push |

**상세 머지 프로토콜**: `WORKFLOW.md` §3 참고.

---

## 5. 모듈 간 인터페이스 / Inter-Module Interfaces

> **wire-format(AppSync GraphQL 계약)은 BACKEND가 `graphql/schema.graphql`에 정의.** 스크립트 모드·라이브 모드가 **동일 계약**을 공유하므로 FRONTEND는 모드를 모른다. 한 쪽이 임의로 변경하면 PR + 다른 모듈에 사전 통보.

### 5.1 GraphQL 뮤테이션 (BACKEND가 정의, FRONTEND가 consumer)

| 뮤테이션 | 모듈 (정의) | 모듈 (사용) |
|---|---|---|
| `createCall` (분석만) | BACKEND | FRONTEND |
| `dialCall` (통화 버튼 발신) | BACKEND | FRONTEND |
| `nextTurn` (스크립트 모드 진행) | BACKEND | FRONTEND, AGENT(emit) |
| `endCall` | BACKEND | FRONTEND, AGENT(요약 트리거) |

**스키마 변경은 BACKEND PR.** 응답 타입(모델 모양)은 DATA와 합의.

### 5.2 GraphQL 구독 (BACKEND 정의 · 값 생산은 AGENT · 팬아웃은 DynamoDB Streams→AppSync)

| 구독 | 페이로드 생산 | 사용 |
|---|---|---|
| `onQueueUpdate` | BACKEND/AGENT | FRONTEND |
| `onTurn` | AGENT (STT/스크립트) | FRONTEND |
| `onIndexUpdate` (churn_risk/emotion) | AGENT | FRONTEND |
| `onSpeechAnalysis` (token polarity/reason) | AGENT | FRONTEND |
| `onStrategyUpdate` (전략 headline) | AGENT | FRONTEND |
| `onComplianceState` (drafting/reviewing/redacting/redrafting/approved) | AGENT | FRONTEND |
| `onMotDetected` | AGENT | FRONTEND |
| `onCallEnded` | BACKEND/AGENT | FRONTEND |

**스키마 변경은 BACKEND PR.** 분석 이벤트(`onIndexUpdate`/`onSpeechAnalysis`/`onStrategyUpdate`/`onMotDetected`/`onComplianceState`)의 의미·값은 AGENT가 산출 → DynamoDB write → Streams → AppSync 팬아웃.

> `onIndexUpdate.churn_risk`(이탈위험도)는 AGENT의 `lambda/orchestrator/agent/churn_risk.py`가 키워드 사전(`data/lexicon/churn_risk_lexicon.json`, S3)으로 계산해 방출합니다. 점수 모델/키워드/가중치 SSOT는 `docs/reference/CHURN-RISK-LEXICON.md` (+ machine-readable `docs/reference/churn_risk_lexicon.json`). 사전 변경은 reference 두 파일 동시 수정 → PR.

### 5.3 데이터 모델 (DATA 정의)

DynamoDB 싱글 테이블 (+Streams): `Call`/`Turn`/`MOT`/`ComplianceReview`/`Summary`/`Product`/`Customer`. PK/SK 설계·마샬링은 DATA 소유 (`docs/nextjs-aws-architecture.md` §4).

### 5.4 모듈 의존성 그래프 (계층)

```
   CLOUD (배포·CI·의존성·PR 게이트 — 전 계층 가로지름, 코드 미소유)
     │
  FRONTEND ──GraphQL(AppSync)──► BACKEND ──► AGENT
                                    │           │
                                    └──► DATA ◄─┘
```

- FRONTEND → BACKEND (AppSync 뮤테이션/구독 consume)
- BACKEND → AGENT (orchestrator Lambda 데이터소스 호출), BACKEND → DATA (resolver가 DynamoDB 직결)
- AGENT → DATA (모델·시나리오·렉시콘 읽기)
- CLOUD는 코드 계층에 직접 의존하지 않지만 배포·CI·의존성·PR을 관장(횡단).

**순환 의존 없음.**

---

## 6. SSOT 운영 / Operating the SSOT

### 6.1 SSOT가 깨졌을 때 (drift 발견)

`./install.sh --verify-modules` 실행해서 yaml ↔ 사람용 표 일치 검사.

**Drift 종류**:
- yaml에 있는데 사람용 표에 없음 → yaml 기준으로 사람용 표 갱신
- 사람용 표에 있는데 yaml에 없음 → yaml에 추가 + 사람용 표는 그대로
- 사람이 yaml과 표 양쪽 모두 갱신해야 합니다. 자동 동기화는 의도적으로 안 함 (drift를 항상 사람이 확인).

### 6.2 새 파일 추가 시

1. `MODULES.md`의 yaml 블록에 파일 추가
2. 위 사람용 표 (§2.1 또는 §2.2)도 같은 셀에 ✅ 표시 추가
3. `./install.sh --verify-modules` 실행해서 일치 확인
4. PR (TEAM LOCK이므로 모든 팀원 approve)

---

## 7. Pre-push hook (자동 강제) / Auto enforcement

`setup-project.sh`가 `.githooks/pre-push`를 설치. push 시점에 변경 파일이 본인 모듈인지 `scripts/check-module-boundary.py`가 본 yaml로 검증 → 위반 시 push block.

**훅 무시하지 마세요.** 우회(`git push --no-verify`) 금지. 시간 압박이 클수록 자동 강제가 안전합니다.

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
- ❌ 동시에 여러 모듈 파일 변경 (작은 PR로 쪼개기)

---

## 9. FAQ

**Q. AGENT 로직이 Lambda 안에 있고 그 Lambda는 CLOUD가 배포하는데 경계는?**
A. 코드(`lambda/orchestrator/agent/*`)는 AGENT 소유, 배포 IaC(`infra/*`)는 CLOUD 소유. 같은 Lambda라도 layer가 다름.

**Q. BACKEND가 정의한 GraphQL 스키마를 AGENT가 emit해야 하면?**
A. 스키마는 BACKEND가 `graphql/`에서 정의. AGENT는 그 계약대로 DynamoDB write만(Streams가 구독 팬아웃). 스키마 변경 필요 시 BACKEND에 PR.

**Q. 화면(상담/CRM)이 한 모듈(FRONTEND)인데 owner 한 명이 다 감당 가능?**
A. FRONTEND(주실)가 화면 전체를 소유. 화면 간 일관성은 한 owner라 오히려 쉬움. 데이터가 필요하면 BACKEND/DATA와 §5 인터페이스로 협의.

**Q. UI wrapper (Button.tsx 등)를 누가 관리?**
A. 누구든 push 가능(`*`). wrapper 변경이 다른 모듈 UI에 영향 줄 수 있으니, 큰 변경은 PR + Demo.

**Q. 시나리오 데이터(`scenario.json`)와 렉시콘은?**
A. DATA 소유(`data/scenarios/*`, `data/lexicon/*`). 단 렉시콘 점수모델 SSOT는 `docs/reference/*`(TEAM-LOCK).

**Q. pre-push hook을 우회해야 할 때?**
A. 거의 없음. 정말 필요하면 owner 합의 + 모듈 boundary 명시. 우회는 항상 기록.

---

## 10. 본 문서 변경 / Updating this doc

1. `MODULES.md` 안 yaml 블록 (§2) 수정
2. 사람용 표 (§2.1, §2.2) 같이 수정
3. `./install.sh --verify-modules` 실행
4. PR (TEAM LOCK, 모든 팀원 approve)

> **Drift는 항상 사람이 확인**합니다. 자동 동기화는 의도적으로 안 함 — 그게 안전.
