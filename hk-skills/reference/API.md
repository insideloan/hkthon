# API — REST + WebSocket 스펙 시트 / API Spec Sheet

> **이 문서는 backend ↔ frontend, 그리고 모듈 간 wire-format의 SSOT입니다.**
> **This document is the SSOT for the backend ↔ frontend and inter-module wire format.**
>
> 상위 진실: 제품 정의는 `reference/PRODUCT-BRIEF.md`, 구조는 `reference/ARCHITECTURE.md`,
> 의존성은 `reference/STACK.md`, 모듈 소유권/인터페이스 계약은 `docs/MODULES.md` §5.
> 본 문서는 그 계약을 **호출 가능한 수준으로 구체화**한 것이며, 충돌 시 PRODUCT-BRIEF가 우선.
>
> **변경 규칙**: REST/WS schema는 **ORCH가 정의**합니다. 변경은 ORCH PR + 사용 모듈 owner 통보
> (`docs/WORKFLOW.md` §3.1 schema 변경 프로토콜).
>
> **포맷 안내 / Formats**:
> - 본 문서(`API.md`)가 **design SSOT** — REST + WebSocket + 화면 매핑을 사람이 읽기 위한 형식.
> - `reference/openapi.yaml` = REST subset의 **machine-readable** 버전 (codegen/contract-test/mock용). §1과 항상 동기화 (변경 시 둘 다 수정 → ORCH PR).
> - **런타임 진실(REST)** 은 FastAPI가 자동 생성하는 `GET /openapi.json` + Swagger UI `/docs`. 구현 후 그것과 대조해 검증 (`hk-verify`).
> - WebSocket(§2)은 OpenAPI로 표현 불가 → 본 문서가 유일한 계약.

---

## 0. 공통 / Conventions

| 항목 | 값 |
|---|---|
| Base URL (REST) | `http://localhost:8000` |
| Base URL (WS) | `ws://localhost:8000` |
| Frontend origin | `http://localhost:3000` (CORS 허용 대상) |
| Content-Type | `application/json; charset=utf-8` (오디오 제외) |
| 인증 | **없음** (데모 한정, localhost only — `ARCHITECTURE.md` §6) |
| 시간 형식 | ISO-8601 UTC (`2026-06-17T08:30:00Z`) |
| ID 형식 | `customer`/`call`/`summary`: ULID 문자열, `transcript`/`scenario_run`: 정수 |
| 엔드포인트 명명 | kebab-case, 복수형 (`/api/calls`, `/api/customers`) — `CONVENTIONS.md` §2 |
| 언어 | 모든 사용자-facing 텍스트(요약, guidance, TTS script)는 한국어 |

### 0.1 시나리오 (2개 고정) / Scenarios

REST/WS의 `scenario` 필드는 항상 `S1`:

| 코드 | 의미 | 종료 동작 |
|---|---|---|
| `S1` | 상품관심 / 한도조회·상담원 연결 요청 | `transfer_to_agent` → 상담원 연결 상태 전환 |

> 통화 시나리오는 1개(S1)입니다. S2/S3/"분노" 시나리오는 존재하지 않습니다. 분기는 LangGraph `classify` 노드가 결정 (`ARCHITECTURE.md` §3.2, `STACK.md` §4).
>
> **금융사기 의심**은 별도 시나리오가 아니라 통화 중 **대시보드 표시용 플래그**입니다. 의심 발화가 감지되면 `fraud_suspected` 플래그를 세워 큐/요약 카드/강조에 반영하지만 **통화는 종료하지 않고 계속 연결**됩니다 (`PRODUCT-BRIEF.md` §4.1).

### 0.2 Call 상태 머신 / Call states

```
DIALING → RINGING → ACCEPTED → IN_CALL → TRANSFER_PENDING → AGENT_JOINED → ENDED
                       │                                                      ▲
                   (REJECTED)──────────────────────────────────────────────┘
```

상태 값: `DIALING | RINGING | ACCEPTED | REJECTED | IN_CALL | TRANSFER_PENDING | AGENT_JOINED | ENDED`

### 0.3 에러 응답 / Error envelope

모든 4xx/5xx는 동일 구조. 외부 API(LLM/STT/TTS) 실패 시 `fallback_message`에 한국어 기본 안내 문구를 담아 통화 흐름이 끊기지 않게 합니다 (`PRODUCT-BRIEF.md` §5 장애 대응).

```json
{
  "error": {
    "code": "LLM_TIMEOUT",
    "message": "LLM 응답 지연으로 기본 안내로 대체했습니다.",
    "fallback_message": "잠시 후 다시 안내해 드리겠습니다.",
    "detail": null
  }
}
```

| code | HTTP | 의미 |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Pydantic/요청 본문 검증 실패 |
| `NOT_FOUND` | 404 | 리소스 없음 (call/customer/summary) |
| `INVALID_STATE` | 409 | 현재 call 상태에서 불가능한 동작 (예: ENDED인데 approve) |
| `LLM_TIMEOUT` | 503 | LLM 첫 토큰 > 타임아웃 → fallback |
| `STT_ERROR` | 503 | Transcribe 스트림 오류 → fallback |
| `TTS_ERROR` | 503 | Typecast 합성 오류 → fallback |
| `INTERNAL` | 500 | 그 외 |

---

## 1. REST API

> 계약 출처: `docs/MODULES.md` §5.1. 아래는 그 계약 + 화면(`PRODUCT-BRIEF.md` §4) 요구를 호출 가능한 수준으로 확장.

### 1.1 대시보드 / 큐 (QUEUE 모듈)

#### `GET /api/queue`
관리자 대시보드 데이터. 상단 요약 카드 + 하단 아웃바운드 대기콜 리스트.

**Query**: `?highlight_only=false`

**200 Response**
```json
{
  "summary": {
    "waiting": 12,
    "in_progress": 3,
    "needs_agent": 2,
    "fraud_suspected": 1,
    "ended": 7
  },
  "rows": [
    {
      "call_id": "01J...",
      "customer_id": "01H...",
      "customer_name": "김영수",
      "target_product": "대환대출",
      "state": "TRANSFER_PENDING",
      "scenario": "S1",
      "highlight": "needs_agent",
      "highlight_since": "2026-06-17T08:31:10Z",
      "elapsed_sec": 95
    }
  ]
}
```

- `summary` = 요약 카드 5종 (대기콜/진행중/상담원 연결 필요/금융사기 의심/종료).
- `highlight` ∈ `null | "needs_agent" | "fraud_suspected"`. 강조 행은 `highlight_since` 기준 경과시간 내림차순으로 상단 고정 (프론트 정렬, `elapsed_sec` 제공). `fraud_suspected`는 강조만 하고 통화는 계속됨.
- 행 클릭은 **콜 시작이 아니라 모니터링 진입**(`/call/{call_id}`) — `GET /api/calls/{id}` 호출 + `/ws/agent` 구독.

### 1.2 통화 / Calls (ORCH 모듈 정의)

#### `POST /api/calls/start`
AI콜봇 자동 발신 트리거. 대기 큐의 고객에 대해 콜을 생성하고 `DIALING`으로 전환. (QUEUE의 auto-dial 로직 또는 데모 제어가 호출. **관리자 행 클릭이 아님.**)

**Request**
```json
{ "customer_id": "01H...", "scenario_hint": "S1" }
```
- `scenario_hint` (선택, 테스트/데모용): `S1`. 현재 시나리오는 1개이므로 사실상 항상 `S1`.

**201 Response**: `Call` 객체 (§3.2)

#### `GET /api/calls/{id}`
실시간 통화 모니터링 화면 스냅샷 (좌: 고객 휴대폰 상태 / 우: AI 분석 패널). WS 연결 전 초기 로드 + 재연결 시 사용.

**200 Response**
```json
{
  "call": { "id": "01J...", "state": "IN_CALL", "scenario": "S1",
            "fraud_suspected": false,
            "started_at": "2026-06-17T08:30:00Z", "agent_joined_at": null },
  "customer": { "id": "01H...", "name": "김영수", "target_product": "대환대출",
                "rate": "연 5.9%", "limit": 50000000,
                "existing_loans": { "own": 12000000, "other": 8000000 },
                "has_vehicle": true,
                "persona": { "tone": "신중함", "needs": ["금리 비교"] } },
  "analysis": {
    "churn_risk": 72,
    "emotion": "불안",
    "ai_action": { "comment": "대환 시 월 4만원 절감 강조", "action": "OFFER_COMPARISON" },
    "rationale": "고객이 타사 금리를 두 번 언급, 이탈 신호",
    "data": { "live": { "last_intent": "한도조회 요청" },
              "static": { "credit_score": 720 } }
  },
  "transcript": [
    { "id": 1, "speaker": "bot", "text": "안녕하세요...", "node_id": "greeting",
      "ts": "2026-06-17T08:30:02Z" }
  ],
  "current_node": "classify"
}
```
- `analysis` = AI 분석 패널: `churn_risk`(이탈위험도 0-100), `emotion`(고객 감정), `ai_action`(추천 Comment/Action), `rationale`(판단 근거), `data`(실시간+기존). 실시간 갱신은 `/ws/agent`의 `index_update`/`guidance`/`ai_action` 메시지.

#### `POST /api/calls/{id}/approve`
상품 가입 승인 (CALL 모니터링 화면의 ProductApproval). 거절은 호출 안 함(no-op, 통화 계속).

**Request**: `{ "product_id": "PROD-001" }` → **200**: `{ "approved": true, "product_id": "PROD-001" }`

#### `POST /api/calls/{id}/transfer`
S1 상담원 연결 상태 전환 (AI콜봇이 자동 트리거하거나 모니터링 화면의 "상담원연결" 버튼). `state → TRANSFER_PENDING` → 관리자 행 강조.

**200**: `Call` (state=`TRANSFER_PENDING`). **409 INVALID_STATE**: 이미 ENDED.

#### `POST /api/calls/{id}/send-link`
"문자URL발송" 버튼 동작 (데모: 실제 SMS 미발송, 발송 사실만 기록).

**Request**: `{ "url": "https://demo/apply" }` → **200**: `{ "sent": true }`

#### `POST /api/calls/{id}/hangup`
통화 종료. `state → ENDED` 후 AI 인계 요약 생성 트리거 (→ §1.5). 고객 iPhone UI의 "종료" 또는 모니터링 화면에서 호출.

**200**: `Call` (state=`ENDED`)

### 1.3 고객 / Customers (ORCH 정의, CALL 사용)

#### `GET /api/customers/{id}`
모니터링 화면 고객 정보 패널용. 페르소나 + 금융 정보.

**200**: `Customer` 객체 (§3.1). **404 NOT_FOUND**.

#### `GET /api/customers`
시드된 데모 고객 목록 (10명). **200**: `{ "customers": [Customer, ...] }`

### 1.4 상품 / Products

#### `GET /api/products`
승인 대상 상품 목록. **200**: `{ "products": [Product, ...] }` (§3.6)

### 1.5 인계 요약 / Summaries (SUMMARY 모듈, ORCH 콜백)

#### `POST /api/summaries`
통화 종료 시 AI가 생성한 인계 요약 저장. ORCH가 `call_ended` 후 콜백으로 호출하거나 SUMMARY 모듈이 생성.

**Request**
```json
{
  "call_id": "01J...",
  "result_type": "한도조회_상담원연결",
  "content": "고객은 대환대출 금리에 관심... 한도조회 요청으로 상담원 연결됨.",
  "flow": ["greeting", "intro_product", "classify", "transfer_to_agent"],
  "categories": ["대환대출", "한도조회", "상담원연결"]
}
```
- `result_type` ∈ `한도조회_상담원연결 | 가입승인 | 거절`.
- `content` = AI 종합 요약(고객 반응/주요 발화/최종 의사). `flow` = 상담 flow 요약(노드 경로). `categories` = 카테고라이징. STT contents는 `GET /api/calls/{id}` transcript에서 결합.

**201**: `Summary` 객체 (§3.5)

#### `GET /api/calls/{id}/summary`
"통화 종료 및 인계 요약 화면" 데이터 (좌: 대화 이력 / 우: AI 요약).

**200 Response**
```json
{
  "summary": { "id": "01S...", "call_id": "01J...",
               "result_type": "한도조회_상담원연결",
               "content": "...", "flow": ["greeting", "..."],
               "categories": ["대환대출"], "created_at": "..." },
  "transcript": [ { "id": 1, "speaker": "bot", "text": "...", "highlight": true } ],
  "handoff_reason": "고객 한도조회 요청 → 상담원 연결",
  "fraud_suspected": false
}
```
- `handoff_reason` = 상담원 연결 사유.
- `fraud_suspected` (bool) = 통화 중 금융사기 의심 발화 감지 여부 (요약 화면에 함께 표시, 통화 종료와 무관).
- transcript의 `highlight: true` = 중요 발화 강조.

---

## 2. WebSocket API

> 계약 출처: `docs/MODULES.md` §5.2, `STACK.md` §5. type 값은 snake_case.
> 모든 프레임: `{ "type": "...", ...payload }`. 공유 타입은 `frontend/src/types/ws.ts` (ORCH 소유).

### 2.1 `/ws/agent` — 관리자/상담원 UI ↔ backend

연결: `ws://localhost:8000/ws/agent?call_id=<id>` (대시보드 전역은 `call_id` 생략 → queue_update만 수신).

**Server → Client (`AgentMsg`)**

| type | payload | 사용 모듈 | 설명 |
|---|---|---|---|
| `queue_update` | `{ rows: QueueRow[], summary: {...} }` | QUEUE | 큐 리스트 + 요약 카드 갱신 |
| `call_started` | `{ call_id, customer: Customer }` | PHONE, CALL | 콜 시작 |
| `transcript` | `{ call_id, speaker, text, node_id, ts }` | CALL | 발화 1건 (`speaker: bot \| customer \| agent`) |
| `node_entered` | `{ call_id, node_id }` | CALL | LangGraph 노드 진입 → 그래프 하이라이트 |
| `index_update` | `{ call_id, churn_risk, emotion }` | CALL | 이탈위험도/감정 게이지 |
| `guidance` | `{ call_id, text, reason }` | CALL | AI Action 추천 Comment + 판단 근거 |
| `ai_action` | `{ call_id, comment, action }` | CALL | 중앙 메인 AI Action 강조 |
| `fraud_flag` | `{ call_id, fraud_suspected }` | QUEUE, CALL | 금융사기 의심 감지 → 대시보드 강조/카드 (통화 계속) |
| `call_ended` | `{ call_id, result_type }` | CALL, SUMMARY | 종료 → 요약 화면 트리거 |
| `error` | `{ code, message, fallback_message }` | (전체) | 외부 API 실패 fallback |

**Client → Server (`AgentCmd`)**

| type | payload | 정의 모듈 | 설명 |
|---|---|---|---|
| `approve_product` | `{ product_id }` | CALL | 가입 승인 (= `POST /approve`의 WS 변형) |
| `transfer_to_agent` | `{}` | CALL | 상담원 연결 (S1) |
| `send_link` | `{ url }` | CALL | 문자URL발송 |
| `mic_speaker` | `{ speaker: "agent" \| "customer" }` | CALL | 마이크 화자 토글 (데모: 단일 마이크) |
| `hangup` | `{}` | CALL | 통화 종료 |
| `next_in_queue` | `{}` | QUEUE | 다음 대기콜 |

### 2.2 `/ws/customer` — 고객 iPhone UI ↔ backend

연결: `ws://localhost:8000/ws/customer?call_id=<id>`.

**Server → Client**

| type | payload | 설명 |
|---|---|---|
| `incoming_call` | `{ call_id, caller_name }` | 수신 화면 표시 (받기/거절) |
| `call_accepted_ack` | `{ call_id }` | 통화 화면 전환 + 타이머 시작 |
| `audio_out` | `{ call_id, format: "mp3", seq, b64 }` | Typecast TTS 오디오 청크 (노트북 스피커 재생) |
| `transcript_in` | `{ call_id, speaker: "bot", text }` | (선택) 자막 |
| `call_ended` | `{ call_id }` | 통화 종료 화면 |

**Client → Server**

| type | payload | 설명 |
|---|---|---|
| `accept` | `{}` | "받기" → `state=ACCEPTED` → STT 스트림 시작 |
| `reject` | `{}` | "거절" → `state=REJECTED` |
| `hangup` | `{}` | "종료" → `state=ENDED` |
| `audio_chunk` | `{ seq, format: "webm", b64 }` | 고객 마이크 2-3초 청크 → Transcribe STT |

### 2.3 오디오 / 음성 파이프라인

```
고객 마이크 → audio_chunk(2-3s) → [STT: AWS Transcribe, ko-KR] → text
  → [LangGraph node: LangChain LLM] → 응답 text
  → [TTS: Typecast, ssfm-v30, 혜라|진서|유라] → mp3 → audio_out → 노트북 스피커
  → /ws/agent: transcript + node_entered + index_update + guidance
```
- 화자 라벨 자동: 고객 발화는 STT 결과(`speaker: customer`), AI콜봇 발화는 TTS 출력문(`speaker: bot`). 별도 화자분리 모델 없음 (`PRODUCT-BRIEF.md` §4.3).
- 지연 목표 (`PRODUCT-BRIEF.md` §5): STT < 2s, LLM 첫 토큰 < 2s, TTS < 1.5s.

---

## 3. 데이터 모델 / Data Models

> DB 컬럼 정의는 `ARCHITECTURE.md` §4. 아래는 API JSON 표현(camelCase는 프론트, snake_case는 DB/REST 본문).
> 저장소: **DuckDB** 단일 파일 (`./app.duckdb`).

### 3.1 Customer
| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | PK |
| `name` | string | 고객명 |
| `phone` | string | 전화번호 |
| `target_product` | string | 대상 상품 |
| `rate` / `limit` | string / int | 금리 / 한도 |
| `existing_loans` | `{own:int, other:int}` | 당사/타사 기존 대출 |
| `has_vehicle` | bool | 차량 보유 여부 (자동차담보대출 판단) |
| `credit_score` | int | 신용점수 |
| `persona` | object | 성격/니즈/우려 (DB: `persona_json`) |
| `scenario_hint` | `S1\|null` | 데모/테스트용 힌트 |

### 3.2 Call
`id, customer_id, state, scenario(S1), fraud_suspected(bool), started_at, ended_at, agent_joined_at`
- `fraud_suspected` = 통화 중 금융사기 의심 발화 감지 시 true (대시보드 표시용, 통화 종료와 무관).

### 3.3 Transcript
`id(int), call_id, speaker(bot|customer|agent), text, node_id, ts` — `highlight`(bool)는 요약 화면 응답에서만 부여.

### 3.4 ScenarioRun (LangGraph 노드 실행 로그)
`id(int), call_id, node_id, entered_at, exited_at, llm_summary`

### 3.5 Summary
`id, call_id, result_type(한도조회_상담원연결|가입승인|거절), content, flow(string[]), categories(string[]), created_at`

### 3.6 Product
`id, name, description, monthly_fee`

---

## 4. 엔드포인트 ↔ 화면 ↔ 모듈 매핑 / Endpoint Map

| 화면 (PRODUCT-BRIEF §4) | REST | WS | 소유 모듈 |
|---|---|---|---|
| 관리자 대시보드 (요약 카드 + 큐) | `GET /api/queue` | `/ws/agent` (`queue_update`) | QUEUE |
| 실시간 통화 모니터링 | `GET /api/calls/{id}`, `GET /api/customers/{id}`, `POST /api/calls/{id}/{approve,transfer,send-link,hangup}` | `/ws/agent` (`transcript`/`node_entered`/`index_update`/`guidance`/`ai_action`) | CALL (+ ORCH) |
| 통화 종료·인계 요약 | `GET /api/calls/{id}/summary`, `POST /api/summaries` | `/ws/agent` (`call_ended`) | SUMMARY (+ ORCH) |
| 고객 iPhone UI | — | `/ws/customer` (전체) | PHONE |
| 음성(STT/TTS) | — | `/ws/customer` (`audio_chunk`/`audio_out`) | ORCH |

> 새 endpoint/메시지 추가 시: 이 문서 + `docs/MODULES.md` §5 + `frontend/src/types/ws.ts` 동시 갱신 → ORCH PR.

---

## 5. Out of Scope (API 레벨)

`PRODUCT-BRIEF.md` §6과 일치:
- ❌ 인증/인가 헤더, 토큰, 세션 — 없음 (localhost 데모).
- ❌ 실제 SMS/이메일/푸시 발송 — `send-link`는 기록만.
- ❌ 실제 전화망/Twilio — `/ws/customer`는 가짜 iPhone UI 시뮬레이션.
- ❌ 멀티테넌시/페이지네이션/rate-limit — 1 관리자 + 1 고객 데모 범위.
- ❌ 외부 금융/신용 API — `Customer.financial`은 시드 가상 데이터.
