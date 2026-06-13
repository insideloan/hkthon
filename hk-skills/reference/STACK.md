# STACK — 기술 스택 / Tech Stack

> **모든 skill은 이 문서를 SSOT로 참조합니다. 변경 시 모든 skill을 재검토하세요.**
> **All skills treat this document as the SSOT. Review all skills when changing it.**

---

## 1. Language & Runtime

| 영역 | 선택 | 버전 | 비고 |
|---|---|---|---|
| Backend | Python | 3.11+ | FastAPI 호환 |
| Frontend | TypeScript | 5.4+ | Next.js 15 + React 19 |
| Frontend styling | Tailwind CSS | 3.4+ | config 기반 theme |
| Database | DuckDB | 0.10+ | 단일 파일, file-based |
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
duckdb = ">=0.10"            # DuckDB Python client
duckdb-engine = ">=0.10"      # SQLAlchemy/DuckDB integration
pydantic = ">=2.9"
pydantic-settings = ">=2.6"   # .env
httpx = ">=0.27"              # AWS API 호출
boto3 = ">=1.35"              # Bedrock
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
│   │   └── memo.py
│   ├── llm/
│   │   ├── router.py           # provider 선택 (bedrock only)
│   │   ├── bedrock.py
│   ├── stt/
│   │   └── aws_transcribe.py   # AWS Transcribe (WebSocket)
│   ├── tts/
│   │   └── aws_polly.py        # AWS Polly (REST)
│   ├── scenarios/
│   │   ├── state_machine.py    # 3개 시나리오 state graph
│   │   ├── S1_product_interest.py
│   │   └── S2_fraud_warning.py
│   ├── ws/
│   │   ├── agent_ws.py         # /ws/agent
│   │   └── customer_ws.py      # /ws/customer
│   └── api/
│       ├── queue.py            # /api/queue
│       ├── calls.py            # /api/calls/*
│       └── memos.py
└── tests/
```

### 환경변수 / Env vars (`.env.example`)

```bash
# LLM
LLM_PROVIDER=bedrock          # bedrock only
LLM_MODEL=anthropic.claude-3-5-sonnet-20241022
AWS_REGION=ap-northeast-2

# AWS Transcribe/AWS Polly
AWS_TRANSCRIBE_REGION=ap-northeast-2
AWS_POLLY_REGION=ap-northeast-2

# App
DATABASE_URL=duckdb:///./app.duckdb
LOG_LEVEL=INFO
```

### LLM Provider 라우팅

- `app/llm/router.py`가 `LLM_PROVIDER` env를 보고 bedrock 모듈만 사용
- 두 provider 모두 **stream=True** 인터페이스로 통일
- 함수 시그니처: `async def stream_chat(messages, system, tools=None) -> AsyncIterator[str]`

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
│   │   ├── page.tsx             # / → agent queue
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
│   │   ├── call/MemoPopup.tsx
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
│       └── transcript.ts
└── public/
```

### Tailwind Theme (template 교체 시)

- `tailwind.config.ts`의 `theme.extend`만 수정해서 전체 색상/폰트/간격 변경
- 컴포넌트는 Tailwind 클래스 직접 사용 금지 → 모두 `src/components/ui/*` wrapper를 통해서
- 새 template을 들여올 때: (1) `tailwind.config.ts` theme 교체, (2) `src/components/ui/*` 내용물만 교체

---

## 4. LLM / STT / TTS

### LLM

- **Primary**: AWS Bedrock — `anthropic.claude-3-5-sonnet-20241022` (현재 Sonnet 4.6)
- **교체 방법**: `.env`의 `LLM_PROVIDER`만 변경
- **System prompt 위치**: `app/llm/prompts/system_ko.txt`

### STT (AWS Transcribe)

- **Protocol**: WebSocket streaming
- **Region**: `ap-northeast-2` (Seoul)
- **입력 모드**: chunked (2-3초 단위 음성 blob)
- **출력**: JSON `{text, isFinal, channel}` → `transcript` 테이블에 저장
- **언어**: 한국어 (`language_code=ko-KR`)

### TTS (AWS Polly)

- **Protocol**: REST
- **Region**: `ap-northeast-2` (Seoul)
- **Voice**: `Seoyeon` (한국어 여성)
- **출력**: MP3 → customer UI로 WebSocket 전송

---

## 5. WebSocket 프로토콜

| Endpoint | 용도 | 메시지 |
|---|---|---|
| `/ws/agent` | 상담원 UI ↔ backend | queue update, call state, transcript chunk, LLM guide |
| `/ws/customer` | 고객 iPhone UI ↔ backend | incoming call, audio out, transcript in |
| (내부) | backend ↔ LLM | stream chat |
| (내부) | backend ↔ AWS Transcribe/AWS Polly | stream STT, REST TTS |

### 메시지 스키마 (TypeScript)

```ts
// backend → agent
type AgentMsg =
  | { type: 'queue_update'; rows: QueueRow[] }
  | { type: 'call_started'; callId: string; customer: Customer }
  | { type: 'transcript'; speaker: 'agent' | 'customer'; text: string; ts: number }
  | { type: 'node_entered'; nodeId: string }
  | { type: 'guidance'; text: string; reason: string }
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
- ❌ **새 LLM provider 추가 금지** (bedrock only).
- ❌ **새 STT/TTS provider 추가 금지** (AWS Transcribe/AWS Polly만).
- ❌ **인증/인가 추가 금지** — 데모는 그냥 open.

위반 발견 시 → `hk-iterate` skill로 가드레일 재확인.
