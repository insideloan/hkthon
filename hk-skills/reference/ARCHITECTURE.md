# ARCHITECTURE — 시스템 아키텍처 / System Architecture

> **모든 skill은 이 아키텍처를 따릅니다. 우회 금지.**
> **All skills must follow this architecture. No detours.**

---

## 1. 컴포넌트 다이어그램 / Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                       Single Developer Machine                       │
│                                                                       │
│  ┌──────────────────────────┐    ┌──────────────────────────────┐   │
│  │  Next.js (port 3000)     │    │  Next.js (port 3000)         │   │
│  │  / → 관리자 UI            │    │  /phone → Customer iPhone UI │   │
│  │  /call/[id] → Call View  │    │  (별도 브라우저 탭/창)        │   │
│  │  - Outbound Queue        │    │  - Incoming call screen      │   │
│  │  - React Flow graph      │    │  - In-call screen + timer    │   │
│  │  - LLM guidance          │    │  - Hangup button             │   │
│  │  - Persona card          │    │                              │   │
│  │  - Product approval      │    │                              │   │
│  │  - Summary panel         │    │                              │   │
│  └──────────────────────────┘    └──────────────────────────────┘   │
│            │ WS+REST                            │ WS                │
│            ▼                                    ▼                    │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │             FastAPI Backend (port 8000)                       │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐  │   │
│  │  │ /ws/    │  │ /ws/    │  │ /api/   │  │ /api/calls/*    │  │   │
│  │  │ agent   │  │ customer│  │ queue   │  │ /api/summaries  │  │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────────────┘  │   │
│  │            │                                                  │   │
│  │            ▼                                                  │   │
│  │  ┌──────────────────────────────────────────────────────┐    │   │
│  │  │       Call Orchestrator (LangGraph StateGraph)       │    │   │
│  │  │  - 현재 call의 scenario + node 추적                   │    │   │
│  │  │  - STT transcript → LangChain LLM → TTS 파이프라인     │    │   │
│  │  │  - classify 노드 + conditional edge로 next-node 결정    │    │   │
│  │  │  - 가드레일: S1 분기 (한도조회→인계 / 그 외→종료)        │    │   │
│  │  └──────────────────────────────────────────────────────┘    │   │
│  │            │            │              │                       │   │
│  │            ▼            ▼              ▼                       │   │
│  │  ┌──────────┐  ┌──────────┐    ┌──────────┐                   │   │
│  │  │ STT      │  │ TTS      │    │ LLM      │                   │   │
│  │  │(Transcribe)│ │ (Polly)  │   │(LangChain│                   │   │
│  │  │ streaming│  │ boto3    │    │ bedrock/ │                   │   │
│  │  │ client   │  │ client   │    │ openai)  │                   │   │
│  │  └──────────┘  └──────────┘    └──────────┘                   │   │
│  │            │            │              │                       │   │
│  │            ▼            ▼              ▼                       │   │
│  │  ┌──────────────────────────────────────────────────────┐    │   │
│  │  │              SQLModel ORM (DuckDB)                     │    │   │
│  │  │  tables: customers, calls, transcripts, summaries,      │    │   │
│  │  │          products, scenario_runs                       │    │   │
│  │  └──────────────────────────────────────────────────────┘    │   │
│  │                          │                                    │   │
│  └──────────────────────────┼────────────────────────────────────┘   │
│                             ▼                                        │
│                  ┌──────────────────────┐                            │
│                  │ DuckDB (./app.duckdb) │                            │
│                  └───────────────────────┘                            │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                  ┌──────────────────────┐
                  │ External services    │
                  │ - Bedrock / OpenAI   │
                  │   (via LangChain)    │
                  │ - AWS Transcribe     │
                  │ - AWS Polly          │
                  └──────────────────────┘
```

---

## 2. 데이터 흐름 (정상 통화 1건) / Data Flow (One Call)

```
1. 관리자(Manager) clicks row in OutboundQueueTable
   └─→ POST /api/calls/start {customerId}
       └─→ Call Orchestrator: create call row, state=DIALING

2. Backend pushes "incoming call" to /ws/customer for that customer
   └─→ Customer iPhone UI shows "받는 화면"

3. Customer clicks "받기"
   └─→ WS cmd {type: 'accept'}
       └─→ state=IN_CALL, scenario=S1 (default)
       └─→ Backend starts STT stream on customer mic

4. Loop (per utterance) — LangGraph 1턴:
   Customer speaks → mic chunk (2-3s) → STT (Transcribe) → text
   → LangGraph node (LangChain LLM: system + scenario state + history) → response text
   → TTS (Polly) → MP3
   → push to /ws/customer (audio out)
   → push to /ws/agent (transcript chunk, node_entered)
   → update graph node

5. Trigger (classify node → conditional edge):
   S1: classify → transfer_to_agent 노드
   → state=TRANSFER_PENDING
   → emit "agent_join" event to /ws/agent
   → 관리자 queue row turns 빨강/초록
   (한도조회/상담원 연결 요청이 아니면 → closing → END)

6. 관리자 clicks red row → /call/[id]
   → state=AGENT_JOINED
   → mic speaker toggle: "agent" (default)
   → agent speaks → STT (with speaker='agent' label)
   → customer hears TTS still
   → but in demo: only one mic. Speaker toggle decides.

7. Agent clicks "가입 승인" or no-op (거부 = no-op, 통화는 계속)
   → if approved: write approval record

8. Customer clicks "종료" (in iPhone UI)
   → state=ENDED
   → AI generates handoff summary
   → POST /api/summaries → DB save (summaries table)
   → 관리자 UI shows summary panel → returns to queue
```

---

## 3. State Machine

### 3.1 Call states

```
DIALING → RINGING → ACCEPTED → IN_CALL → TRANSFER_PENDING
                                              ↓
                                       AGENT_JOINED → IN_CALL(2)
                                              ↓
                                            ENDED
```

- `DIALING` — backend initiated, customer not yet notified
- `RINGING` — push sent to /ws/customer
- `ACCEPTED` / `REJECTED` — customer's first decision
- `IN_CALL` — AI bot in conversation
- `TRANSFER_PENDING` — LLM triggered transfer, waiting for agent to click
- `AGENT_JOINED` — agent took over
- `IN_CALL(2)` — agent + (optionally) customer still in mic loop
- `ENDED` — call finished, AI summary generated

### 3.2 Scenario states

시나리오는 **고정 노드 그래프** 1개(S1). LLM은 그 안에서 script만 생성.

**S1 (한도조회 → 상담원 연결)**:
```
GREETING → INTRO_PRODUCT → HANDLE_OBJECTION → OFFER_SIGNUP
  → [signup_yes / 한도조회 요청] → TRANSFER_TO_AGENT (상담원 연결)
  → [signup_no]                 → CLOSING → END
```

각 노드 (LangGraph node 함수, `app/agent/nodes.py`)는:
- 진입 시 LangChain LLM 호출 (system + history + node prompt)
- 다음 노드 = `classify` 노드의 LLM 판단 → LangGraph conditional edge
- 상담원 인계 = `transfer_to_agent` 노드로 라우팅

그래프 조립은 `app/agent/graph.py` (`build_graph`), 시나리오별 노드 셋/엣지는 `backend/app/scenarios/<id>.py`에 있음 (각 skill이 그곳에 코드를 작성).

---

## 4. 데이터 모델 (DB) / Data Model

```sql
-- customers
id              TEXT PRIMARY KEY
name            TEXT
phone           TEXT
persona_json    TEXT    -- 성격, 니즈, 우려사례
credit_score    INTEGER
financial_json  TEXT    -- 소득, 부채, 보유 상품
scenario_hint   TEXT    -- S1 (테스트용)

-- calls
id              TEXT PRIMARY KEY
customer_id     TEXT REFERENCES customers(id)
state           TEXT    -- DIALING | RINGING | ...
scenario        TEXT    -- S1
started_at      DATETIME
ended_at        DATETIME
agent_joined_at DATETIME

-- transcripts
id              INTEGER PRIMARY KEY AUTOINCREMENT
call_id         TEXT REFERENCES calls(id)
speaker         TEXT    -- agent | customer | bot
text            TEXT
node_id         TEXT
ts              DATETIME

-- scenario_runs
id              INTEGER PRIMARY KEY AUTOINCREMENT
call_id         TEXT REFERENCES calls(id)
node_id         TEXT
entered_at      DATETIME
exited_at       DATETIME
llm_summary     TEXT

-- summaries
id              TEXT PRIMARY KEY
call_id         TEXT REFERENCES calls(id)
result_type     TEXT    -- 한도조회_상담원연결 | 가입승인 | 거절
content         TEXT    -- AI 생성 인계 요약
created_at      DATETIME

-- products
id              TEXT PRIMARY KEY
name            TEXT
description     TEXT
monthly_fee     INTEGER
```

---

## 5. 디렉토리 ↔ 아키텍처 매핑 / Directory ↔ Architecture

| 컴포넌트 | 위치 |
|---|---|
| Agent 그래프 (LangGraph) | `backend/app/agent/graph.py` + `app/agent/nodes.py` + `app/agent/state.py` |
| State machine (그래프 조립) | `backend/app/scenarios/state_machine.py` |
| LLM router (LangChain) | `backend/app/llm/router.py` |
| STT bridge | `backend/app/stt/transcribe_stt.py` |
| TTS bridge | `backend/app/tts/polly_tts.py` |
| Agent WS | `backend/app/ws/agent_ws.py` |
| Customer WS | `backend/app/ws/customer_ws.py` |
| Agent queue UI | `frontend/src/components/queue/OutboundQueueTable.tsx` |
| Call graph | `frontend/src/components/call/CallGraph.tsx` |
| Customer phone | `frontend/src/components/phone/PhoneFrame.tsx` |
| Mic toggle | `frontend/src/lib/mic.ts` + `agent UI toggle` |

> **우회 금지**: 이 구조를 따르세요. 새로 파일을 만들 때는 위 위치를 우선 사용.

---

## 6. 보안 / Security (데모 한정 / Demo-only)

- ❌ 인증 없음 (localhost만)
- ❌ HTTPS 없음 (ws://, http://)
- ❌ .env는 .gitignore
- ✅ CORS: `localhost:3000`만 허용
- ✅ 입력 검증: Pydantic / Zod
- ✅ SQL injection: DuckDB + SQLModel ORM 사용

---

## 7. 배포 / Deployment (Out of Scope, 24h)

- ❌ 클라우드 배포 없음
- ❌ Docker 없음
- ✅ 로컬 실행만:
  ```bash
  # backend
  cd backend && uvicorn app.main:app --reload --port 8000
  # frontend
  cd frontend && pnpm dev
  # seed
  python -m app.seed
  ```
