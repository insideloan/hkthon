# STACK — 기술 스택 / Tech Stack

> **모든 skill은 이 문서를 SSOT로 참조합니다. 변경 시 모든 skill을 재검토하세요.**
> **All skills treat this document as the SSOT. Review all skills when changing it.**

---

## 1. Language & Runtime

| 영역 | 선택 | 버전 | 비고 |
|---|---|---|---|
| Backend | Python | 3.13+ | FastAPI 호환 |
| Frontend | TypeScript | 5.4+ | Next.js 15 + React 19 |
| Frontend styling | Tailwind CSS | 3.4+ | config 기반 theme |
| Database | DuckDB | 1.0+ | 단일 파일, file-based |
| Package manager (FE) | pnpm | 9+ | npm/yarn 대체 가능 |
| Package manager (BE) | uv 또는 pip | uv 0.4+ | pip-tools 대안 |

---

## 2. Backend (FastAPI)

### 핵심 의존성 / Core deps

```toml
# pyproject.toml 또는 requirements.txt
fastapi = ">=0.115"
uvicorn[standard] = ">=0.32"
websockets = ">=13"
sqlmodel = ">=0.0.22"        # ORM (Pydantic + SQLAlchemy)
duckdb = ">=1.0"              # DuckDB (단일 파일 DB)
pydantic = ">=2.9"
pydantic-settings = ">=2.6"   # .env
httpx = ">=0.27"              # 기타 HTTP 호출
boto3 = ">=1.35"              # AWS (Bedrock + Transcribe STT)
langchain = ">=0.3"           # LLM 추상화
langgraph = ">=0.2"           # Agent state graph (오케스트레이터)
langchain-aws = ">=0.2"       # Bedrock (ChatBedrockConverse)
langchain-openai = ">=0.2"    # OpenAI (대체, ChatOpenAI)
amazon-transcribe = ">=0.6"   # AWS Transcribe streaming STT
python-multipart = ">=0.0.20" # WebSocket audio upload
```

### 디렉토리 구조 / Directory layout

```
backend/
├── pyproject.toml
├── .env.example
├── app/
│   ├── main.py                 # FastAPI app + WebSocket routes
│   ├── config.py               # Settings (pydantic-settings)
│   ├── db.py                   # SQLModel engine + session
│   ├── models/                 # SQLModel 테이블
│   │   ├── customer.py
│   │   ├── call.py
│   │   ├── transcript.py
│   │   └── summary.py
│   ├── agent/                  # LangGraph 오케스트레이터
│   │   ├── graph.py            # StateGraph 빌드/컴파일 (build_graph, run_turn)
│   │   ├── state.py            # CallState (messages, scenario, node, intent...)
│   │   └── nodes.py            # 노드 함수 (greeting, classify, transfer, warn...)
│   ├── llm/
│   │   ├── router.py           # LangChain chat model 선택 (bedrock | openai)
│   │   ├── bedrock.py          # ChatBedrockConverse (langchain-aws)
│   │   └── openai_compat.py    # ChatOpenAI (langchain-openai)
│   ├── stt/
│   │   └── transcribe_stt.py   # AWS Transcribe streaming STT
│   ├── tts/
│   │   └── typecast_tts.py     # Typecast TTS (REST, httpx)
│   ├── scenarios/
│   │   ├── state_machine.py    # S1 시나리오 LangGraph 그래프 조립
│   │   └── S1_handoff.py
│   ├── ws/
│   │   ├── agent_ws.py         # /ws/agent
│   │   └── customer_ws.py      # /ws/customer
│   └── api/
│       ├── queue.py            # /api/queue
│       ├── calls.py            # /api/calls/*
│       └── summaries.py        # /api/summaries
└── tests/
```

### 환경변수 / Env vars (`.env.example`)

```bash
# LLM
LLM_PROVIDER=bedrock          # bedrock | openai
LLM_MODEL=anthropic.claude-3-5-sonnet-20241022
AWS_REGION=ap-northeast-2
# OpenAI (대체 시)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o

# AWS STT (Transcribe)
# 자격증명은 표준 AWS 체인 사용 (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY 또는 프로필)
# AWS_REGION 는 위 LLM 섹션과 공유
TRANSCRIBE_LANGUAGE=ko-KR

# TTS (Typecast)
TYPECAST_API_KEY=tc_...        # https://typecast.ai 발급 (X-API-KEY 헤더)
TYPECAST_MODEL=ssfm-v30        # ssfm-v30(권장) | ssfm-v21
TYPECAST_VOICE=혜라            # 혜라 | 진서 | 유라 (한국어 여성, 이름→voice_id 매핑은 §4 참고)
TYPECAST_AUDIO_FORMAT=mp3      # mp3 | wav

# App
DATABASE_URL=duckdb:///./app.duckdb
LOG_LEVEL=INFO
```

### LLM Provider 라우팅 + Agent 그래프

- `app/llm/router.py`가 `LLM_PROVIDER` env를 보고 LangChain chat model 선택 (bedrock → `ChatBedrockConverse`, openai → `ChatOpenAI`) → `BaseChatModel` 반환
- 두 provider 모두 LangChain `.astream()` 스트리밍 인터페이스로 통일
- 오케스트레이터는 **LangGraph `StateGraph`** (`app/agent/graph.py`). 노드가 LangChain model을 호출하고, conditional edge로 시나리오 분기 (§4 참고)
- 함수 시그니처: `async def run_turn(state: CallState) -> CallState` (그래프 1턴 실행)

---

## 3. Frontend (Next.js)

### 핵심 의존성 / Core deps

```json
{
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwindcss": "^3.4.0",
    "@xyflow/react": "^12.3.0",          // 노드 그래프
    "lucide-react": "^0.460.0",          // 아이콘
    "zustand": "^5.0.0",                 // 클라이언트 상태
    "zod": "^3.23.0",                    // 타입/검증
    "clsx": "^2.1.1"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0"
  }
}
```

### 디렉토리 구조 / Directory layout

```
frontend/
├── package.json
├── tailwind.config.ts           # theme/colors는 여기 (template 교체 용이)
├── next.config.mjs
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx             # / → 관리자 대시보드 (outbound queue)
│   │   ├── call/[id]/page.tsx   # /call/[id] → agent 통화 화면
│   │   └── phone/page.tsx       # /phone → customer iPhone UI
│   ├── components/
│   │   ├── ui/                  # wrapper components (template origin)
│   │   │   ├── Button.tsx
│   │   │   ├── Table.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Modal.tsx
│   │   │   └── ...
│   │   ├── queue/OutboundQueueTable.tsx
│   │   ├── call/CallGraph.tsx          # React Flow
│   │   ├── call/TranscriptPanel.tsx
│   │   ├── call/GuidancePanel.tsx
│   │   ├── call/PersonaCard.tsx
│   │   ├── call/ProductApproval.tsx
│   │   ├── call/SummaryPanel.tsx
│   │   └── phone/PhoneFrame.tsx        # iPhone UI
│   ├── lib/
│   │   ├── api.ts               # REST client
│   │   ├── ws.ts                # WebSocket client
│   │   └── mic.ts               # mic + Web Audio playback
│   ├── stores/                  # zustand
│   │   ├── queueStore.ts
│   │   └── callStore.ts
│   └── types/                   # backend와 공유되는 types
│       ├── call.ts
│       ├── customer.ts
│       ├── transcript.ts
│       └── summary.ts
└── public/
```

### Tailwind Theme (template 교체 시)

- `tailwind.config.ts`의 `theme.extend`만 수정해서 전체 색상/폰트/간격 변경
- 컴포넌트는 Tailwind 클래스 직접 사용 금지 → 모두 `src/components/ui/*` wrapper를 통해서
- 새 template을 들여올 때: (1) `tailwind.config.ts` theme 교체, (2) `src/components/ui/*` 내용물만 교체

---

## 4. Agent (LangGraph) / LLM / STT (Transcribe) / TTS (Typecast)

### Agent 그래프 (LangGraph)

오케스트레이터는 LangGraph `StateGraph`. S1 시나리오를 conditional edge로 분기:

```
START → greeting → intro_product → classify
classify ─(limit_inquiry|connect)──→ handle_objection → transfer_to_agent → generate_summary → END  (S1)
classify ─(not_interested)─────────→ closing ──────────────────────────→ generate_summary → END

detect_fraud (매 턴 병렬 체크) ──→ fraud_suspected=true → /ws/agent fraud_flag (대시보드 표시, 종료 안 함)
```

- `classify` = LLM 라우팅 노드. 한도조회/상담원 연결 요청 또는 상품 관심 → S1 인계, 무관심 → 종료
- `transfer_to_agent` = S1 상담원 연결 상태 전환 (인계)
- `detect_fraud` = 금융사기 의심 발화를 감지해 `fraud_suspected` 플래그만 세움. **라우팅/종료에 영향 없음** (대시보드 표시 전용)
- `generate_summary` = 통화 종료 시 실행 → `summaries` 테이블에 AI 인계 요약 기록
- State: `CallState` (`app/agent/state.py`) — messages, scenario, current_node, customer, intent, fraud_suspected, next, summary

### LLM (LangChain)

- **Model**: AWS Bedrock — `global.anthropic.claude-sonnet-4-6` (`ChatBedrockConverse`, langchain-aws)
- **대체**: OpenAI `ChatOpenAI` (langchain-openai)
- **System prompt 위치**: `app/llm/prompts/system_ko.txt`

### STT (AWS Transcribe Streaming)

- **Protocol**: streaming (amazon-transcribe async SDK, HTTP/2)
- **입력 모드**: chunked (2-3초 단위 음성 blob)
- **출력**: JSON `{text, isFinal}` → `transcript` 테이블에 저장
- **언어**: 한국어 (`LanguageCode=ko-KR`)

### TTS (Typecast)

- **Protocol**: REST (httpx) — `POST https://api.typecast.ai/v1/text-to-speech`, 헤더 `X-API-KEY: <TYPECAST_API_KEY>`
- **Model**: `ssfm-v30` (권장) — `TYPECAST_MODEL`
- **Voice**: `혜라` / `진서` / `유라` 중 선택 (`TYPECAST_VOICE`, 한국어 여성). 셋 모두 데모용 화자.
- **이름 → voice_id 매핑**: 요청 본문은 `voice_id`(`tc_...`)를 요구함. `typecast_tts.py`는 아래 고정 매핑을 사용한다 (목록 확인: `GET https://api.typecast.ai/v2/voices`):

  | 이름 | voice_id |
  |---|---|
  | 혜라 | `tc_66504763aed05555cd12438c` |
  | 진서 | `tc_65bb3a1976b69213594357fc` |
  | 유라 | `tc_61130d6cf89dd58a4c13295d` |
- **요청 예**:
  ```json
  {
    "model": "ssfm-v30",
    "text": "안녕하세요, AI 상담원이에요.",
    "voice_id": "tc_66504763aed05555cd12438c",
    "language": "kor",
    "output": { "audio_format": "mp3" }
  }
  ```
- **출력**: 바이너리 오디오(MP3) 응답 → customer UI로 WebSocket 전송. 실패 시 `TTS_ERROR` → fallback (`API.md` §0.3).

---

## 5. WebSocket 프로토콜

| Endpoint | 용도 | 메시지 |
|---|---|---|
| `/ws/agent` | 관리자 UI ↔ backend | queue update, call state, transcript chunk, LLM guide |
| `/ws/customer` | 고객 iPhone UI ↔ backend | incoming call, audio out, transcript in |
| (내부) | backend ↔ LLM (LangChain) | stream chat |
| (내부) | backend ↔ AWS Transcribe | stream STT |
| (내부) | backend ↔ Typecast | REST TTS (`/v1/text-to-speech`) |

### 메시지 스키마 (TypeScript)

```ts
// backend → agent
type AgentMsg =
  | { type: 'queue_update'; rows: QueueRow[] }
  | { type: 'call_started'; callId: string; customer: Customer }
  | { type: 'transcript'; speaker: 'agent' | 'customer'; text: string; ts: number }
  | { type: 'node_entered'; nodeId: string }
  | { type: 'guidance'; text: string; reason: string }
  | { type: 'fraud_flag'; callId: string; fraudSuspected: boolean }
  | { type: 'call_ended'; callId: string };

// agent → backend
type AgentCmd =
  | { type: 'approve_product'; productId: string }
  | { type: 'next_in_queue' }
  | { type: 'mic_speaker'; speaker: 'agent' | 'customer' }
  | { type: 'hangup' };
```

---

## 6. 개발 도구 / Dev Tools

| 용도 | 도구 |
|---|---|
| Backend hot reload | `uvicorn app.main:app --reload` |
| Frontend dev | `pnpm dev` (port 3000) |
| Backend port | 8000 |
| Lint (FE) | ESLint (next lint) |
| Lint (BE) | ruff |
| Type check (FE) | tsc --noEmit |
| Type check (BE) | mypy (선택) |
| DB 초기화 | `python -m app.db_init` (마이그레이션) |
| Seed data | `python -m app.seed` (고객 10명, 페르소나) |

---

## 7. 금지 / Forbidden

- ❌ **새 의존성 추가 금지** (해커톤 중). 정말 필요하면 팀 합의 + 이 문서 업데이트.
- ❌ **직접 SQL 작성 금지** — SQLModel ORM만 사용.
- ❌ **Inline `style={{...}}` 금지** — Tailwind 클래스만.
- ❌ **새 LLM provider 추가 금지** (bedrock/openai만, LangChain 경유).
- ❌ **새 STT/TTS provider 추가 금지** (STT는 AWS Transcribe, TTS는 Typecast만). TTS voice는 `혜라`/`진서`/`유라` 중에서만 선택.
- ❌ **인증/인가 추가 금지** — 데모는 그냥 open.

위반 발견 시 → `hk-iterate` skill로 가드레일 재확인.
