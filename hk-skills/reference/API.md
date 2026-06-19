# API — AppSync GraphQL 계약 / AppSync GraphQL Contract

> **이 문서는 FRONTEND ↔ BACKEND ↔ AGENT 모듈 간 wire-format의 SSOT입니다.**
> **This document is the SSOT for the inter-module wire format (FRONTEND ↔ BACKEND ↔ AGENT).**
>
> 상위 진실: 제품 정의는 `data/consult_merged-4.html` (HTML SSOT),
> 아키텍처는 `docs/nextjs-aws-architecture.md`,
> 모듈 소유권·인터페이스 계약은 `docs/MODULES.md` §5.
> 본 문서는 그 계약을 **호출 가능한 수준으로 구체화**한 것이며, 충돌 시 HTML SSOT가 우선.
>
> **변경 규칙**: GraphQL 스키마는 **BACKEND가 정의**합니다(`graphql/schema.graphql`). 데이터 모양은 DATA, 클라이언트 타입은 FRONTEND와 합의. 변경은 BACKEND PR + 사용 모듈 owner 통보
> (`docs/WORKFLOW.md` §3.1 schema 변경 프로토콜).
>
> **포맷 안내 / Formats**:
> - 본 문서(`API.md`)가 **design SSOT** — GraphQL 오퍼레이션 + 화면 매핑을 사람이 읽기 위한 형식.
> - `graphql/schema.graphql` = **machine-readable SSOT** (codegen / contract-test / mock 용). BACKEND 소유(`docs/MODULES.md` §2.1). 본 문서와 항상 동기화 — 변경 시 둘 다 수정 → BACKEND PR.
> - ~~`reference/openapi.yaml`~~ — **폐기(deprecated)**. AppSync는 REST가 아닌 GraphQL SDL을 계약으로 사용합니다. `openapi.yaml`은 `graphql/schema.graphql`로 대체되었습니다.
> - **런타임 진실** 은 AppSync 콘솔의 스키마 탭 + CloudWatch 로그. 구현 후 그것과 대조해 검증 (`hk-verify`).
> - WebSocket(구독)은 AppSync WSS 프로토콜로 통합됩니다 — 별도 `/ws/` 엔드포인트 없음.

---

## 0. 공통 / Conventions

| 항목 | 값 |
|---|---|
| GraphQL 엔드포인트 (HTTP / Mutation + Query) | `https://<api-id>.appsync-api.<region>.amazonaws.com/graphql` |
| GraphQL 엔드포인트 (WSS / Subscription) | `wss://<api-id>.appsync-realtime-api.<region>.amazonaws.com/graphql` |
| 호스트 결정 | CDK 프로비저닝 시 자동 발급 — `infra/` 참고 (CLOUD 소유) |
| 인증 | **AppSync API 키** (데모 한정, 부스 무인증). `x-api-key` 헤더. |
| 프론트 클라이언트 | `frontend/src/lib/appsync.ts` (Amplify `generateClient()`, FRONTEND 소유) |
| 시간 형식 | ISO-8601 UTC (`2026-06-17T08:30:00Z`) |
| ID 형식 | `customer`/`call`/`summary`: ULID 문자열, `turn`/`mot`: 정수 시퀀스 |
| 언어 | 모든 사용자-facing 텍스트(요약·guidance·TTS script)는 **한국어** |

### 0.1 시나리오 / Scenarios

GraphQL 필드의 `scenario` 값은 항상 `S1`:

| 코드 | 의미 | 종료 동작 |
|---|---|---|
| `S1` | 상품관심 / 한도조회·상담원 연결 요청 | `transferToAgent` 뮤테이션 → `TRANSFER_PENDING` 전환 |

> 통화 시나리오는 1개(S1)입니다. S2/S3/"분노" 시나리오는 존재하지 않습니다.
>
> **금융사기 의심(`fraud_suspected`)** 은 별도 시나리오가 아니라 통화 중 **대시보드 표시용 플래그**입니다. 의심 발화가 감지되면 `fraud_suspected: true`로 큐/요약 카드/강조에 반영하지만 **통화는 종료하지 않고 계속 연결**됩니다.

### 0.2 Call 상태 머신 / Call States

```
DIALING → RINGING → ACCEPTED → IN_CALL → TRANSFER_PENDING → AGENT_JOINED → ENDED
                       │                                                      ▲
                   (REJECTED)──────────────────────────────────────────────┘
```

상태 값: `DIALING | RINGING | ACCEPTED | REJECTED | IN_CALL | TRANSFER_PENDING | AGENT_JOINED | ENDED`

### 0.3 에러 / GraphQL Errors

AppSync는 에러를 HTTP 200 + `errors[]` 배열로 반환합니다. 외부 API(LLM/STT/TTS) 실패 시 `extensions.fallbackMessage`에 한국어 기본 안내 문구를 담아 통화 흐름이 끊기지 않게 합니다.

```json
{
  "errors": [
    {
      "message": "LLM 응답 지연으로 기본 안내로 대체했습니다.",
      "extensions": {
        "code": "LLM_TIMEOUT",
        "fallbackMessage": "잠시 후 다시 안내해 드리겠습니다."
      }
    }
  ],
  "data": null
}
```

| code | 의미 |
|---|---|
| `VALIDATION_ERROR` | 인자 검증 실패 |
| `NOT_FOUND` | 리소스 없음 (call/customer/summary) |
| `INVALID_STATE` | 현재 call 상태에서 불가능한 동작 (예: ENDED 상태에서 approve) |
| `LLM_TIMEOUT` | LLM 첫 토큰 타임아웃 → fallback 사용 |
| `STT_ERROR` | Transcribe 스트림 오류 → fallback 사용 |
| `TTS_ERROR` | Typecast 합성 오류 → fallback 사용 |
| `INTERNAL` | 그 외 내부 오류 |

---

## 1. GraphQL Mutations (뮤테이션)

> BACKEND가 스키마 정의 (`graphql/schema.graphql`). FRONTEND가 호출. AGENT가 내부에서 실행 트리거.

### 1.1 `createCall` — 사전 분석 전용 콜 생성

사전 고객분석 화면(`/segment/[customerId]`) 진입 시 분석 전용으로 호출. **통화 발신은 하지 않음** — 발신은 `dialCall`.

```graphql
mutation CreateCall($customerId: ID!, $scenarioHint: String) {
  createCall(customerId: $customerId, scenarioHint: $scenarioHint) {
    id
    state
    customerId
    scenario
    startedAt
  }
}
```

**인자**

| 인자 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `customerId` | `ID!` | ✅ | 대상 고객 ULID |
| `scenarioHint` | `String` | — | 항상 `"S1"`. 데모/테스트용 힌트 |

**반환**: `Call` (§3.2). 초기 state = `DIALING` 아님 — 분석 중 대기 상태.

**샘플 응답**
```json
{
  "data": {
    "createCall": {
      "id": "01J9XXXXXXXXXXXXXX",
      "state": "DIALING",
      "customerId": "01H9XXXXXXXXXXXXXX",
      "scenario": "S1",
      "startedAt": "2026-06-19T03:00:00Z"
    }
  }
}
```

---

### 1.2 `dialCall` — 통화 버튼 발신

사전 고객분석 완료 후 **"통화" 버튼 클릭** 시 호출 → `state = DIALING`. 행 클릭은 모니터링 진입이며 자동 발신하지 않습니다.

```graphql
mutation DialCall($customerId: ID!) {
  dialCall(customerId: $customerId) {
    id
    state
    customerId
    scenario
    startedAt
  }
}
```

**인자**

| 인자 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `customerId` | `ID!` | ✅ | 대상 고객 ULID |

**반환**: `Call` (state = `DIALING`).

**샘플 응답**
```json
{
  "data": {
    "dialCall": {
      "id": "01J9XXXXXXXXXXXXXX",
      "state": "DIALING",
      "customerId": "01H9XXXXXXXXXXXXXX",
      "scenario": "S1",
      "startedAt": "2026-06-19T03:00:05Z"
    }
  }
}
```

---

### 1.3 `nextTurn` — 스크립트 모드 다음 턴 진행

스크립트 모드에서 Lambda orchestrator가 `scenario.json`의 다음 턴을 emit. FRONTEND의 "다음" 버튼 또는 자동 타이머가 호출.

```graphql
mutation NextTurn($callId: ID!) {
  nextTurn(callId: $callId) {
    callId
    seq
    speaker
    text
    node
    churnAfter
    tokens {
      text
      polarity
      reason
    }
  }
}
```

**인자**: `callId: ID!`

**반환**: `Turn` (§3.3). 동시에 `onTurn` 구독으로도 브로드캐스트됨.

**샘플 응답**
```json
{
  "data": {
    "nextTurn": {
      "callId": "01J9XXXXXXXXXXXXXX",
      "seq": 3,
      "speaker": "customer",
      "text": "다른 은행은 4.5% 준다던데 여기는 얼마에요?",
      "node": "classify",
      "churnAfter": 68,
      "tokens": [
        { "text": "다른 은행", "polarity": "CONS", "reason": "타사 비교 언급 — 이탈 신호" },
        { "text": "4.5%", "polarity": "CONS", "reason": "경쟁사 금리 직접 제시" }
      ]
    }
  }
}
```

---

### 1.4 `endCall` — 통화 종료

통화 종료 → `state = ENDED` + 인계 요약 생성 트리거. 모니터링 화면의 "종료" 버튼 또는 스크립트 모드 자동 종료가 호출.

```graphql
mutation EndCall($callId: ID!) {
  endCall(callId: $callId) {
    id
    state
    endedAt
  }
}
```

**인자**: `callId: ID!`

**반환**: `Call` (state = `ENDED`). 동시에 `onCallEnded` 구독 브로드캐스트.

**샘플 응답**
```json
{
  "data": {
    "endCall": {
      "id": "01J9XXXXXXXXXXXXXX",
      "state": "ENDED",
      "endedAt": "2026-06-19T03:18:00Z"
    }
  }
}
```

---

### 1.5 `approveProduct` — 상품 가입 승인

모니터링 화면의 ProductApproval 컴포넌트에서 호출. 거절은 호출하지 않음 (no-op, 통화 계속).

```graphql
mutation ApproveProduct($callId: ID!, $productId: ID!) {
  approveProduct(callId: $callId, productId: $productId) {
    approved
    productId
    callId
  }
}
```

**샘플 응답**
```json
{
  "data": {
    "approveProduct": {
      "approved": true,
      "productId": "PROD-001",
      "callId": "01J9XXXXXXXXXXXXXX"
    }
  }
}
```

---

### 1.6 `transferToAgent` — 상담원 연결

S1 전환 트리거. AI 콜봇이 자동 트리거하거나 모니터링 화면의 "상담원연결" 버튼이 호출. → `state = TRANSFER_PENDING` → 관리자 큐 행 강조.

```graphql
mutation TransferToAgent($callId: ID!) {
  transferToAgent(callId: $callId) {
    id
    state
  }
}
```

**샘플 응답**
```json
{
  "data": {
    "transferToAgent": {
      "id": "01J9XXXXXXXXXXXXXX",
      "state": "TRANSFER_PENDING"
    }
  }
}
```

에러: `INVALID_STATE` (이미 ENDED).

---

### 1.7 `sendLink` — 문자 URL 발송

"문자URL발송" 버튼. 데모: 실제 SMS 미발송, 발송 사실만 DynamoDB에 기록.

```graphql
mutation SendLink($callId: ID!, $url: String!) {
  sendLink(callId: $callId, url: $url) {
    sent
    callId
    url
  }
}
```

**샘플 응답**
```json
{
  "data": {
    "sendLink": {
      "sent": true,
      "callId": "01J9XXXXXXXXXXXXXX",
      "url": "https://demo/apply"
    }
  }
}
```

> `endCall`이 `hangup`을 겸합니다 — 별도 `hangup` 뮤테이션 없음.

---

## 2. GraphQL Subscriptions (구독)

> BACKEND가 스키마 정의, AGENT가 값 생산, DynamoDB Streams → Lambda → AppSync 팬아웃.
> 모든 구독은 `wss://` 엔드포인트 연결 후 AppSync Subscription 프로토콜(Amplify `client.subscribe()`) 사용.
> 구독 consumer는 FRONTEND. 이벤트 값 생산은 AGENT(`lambda/orchestrator/agent/*`).

### 2.1 `onQueueUpdate` — 큐 전체 갱신

관리자 대시보드 큐 리스트 + 요약 카드 실시간 갱신. `callId` 인자 없음 — 전역 구독.

```graphql
subscription OnQueueUpdate {
  onQueueUpdate {
    summary {
      waiting
      inProgress
      needsAgent
      fraudSuspected
      ended
    }
    rows {
      callId
      customerId
      customerName
      targetProduct
      state
      scenario
      highlight
      highlightSince
      elapsedSec
    }
  }
}
```

**샘플 페이로드**
```json
{
  "data": {
    "onQueueUpdate": {
      "summary": {
        "waiting": 12,
        "inProgress": 3,
        "needsAgent": 2,
        "fraudSuspected": 1,
        "ended": 7
      },
      "rows": [
        {
          "callId": "01J9XXXXXXXXXXXXXX",
          "customerId": "01H9XXXXXXXXXXXXXX",
          "customerName": "김영수",
          "targetProduct": "대환대출",
          "state": "TRANSFER_PENDING",
          "scenario": "S1",
          "highlight": "needs_agent",
          "highlightSince": "2026-06-19T03:06:10Z",
          "elapsedSec": 95
        }
      ]
    }
  }
}
```

- `highlight` ∈ `null | "needs_agent" | "fraud_suspected"`. `fraud_suspected` 강조는 통화를 종료하지 않습니다.
- 행 클릭은 **모니터링 진입**(`/calls/[id]`) — 자동 발신 아님.

---

### 2.2 `onTurn` — 발화 스트리밍

통화 중 발화 1건씩 수신. 스크립트 모드에서는 `nextTurn` 뮤테이션 응답과 동일 페이로드를 구독으로도 브로드캐스트. 라이브 모드에서는 AGENT가 STT 결과 확정 후 emit.

```graphql
subscription OnTurn($callId: ID!) {
  onTurn(callId: $callId) {
    callId
    seq
    speaker
    text
    node
    churnAfter
    tokens {
      text
      polarity
      reason
    }
  }
}
```

**샘플 페이로드**
```json
{
  "data": {
    "onTurn": {
      "callId": "01J9XXXXXXXXXXXXXX",
      "seq": 5,
      "speaker": "bot",
      "text": "대환대출로 전환하시면 월 약 4만원 절감이 가능합니다.",
      "node": "offer_comparison",
      "churnAfter": 45,
      "tokens": [
        { "text": "월 약 4만원 절감", "polarity": "PRO", "reason": "절감 효과 구체적 제시 — 전환 유인" }
      ]
    }
  }
}
```

- `speaker` ∈ `bot | customer | agent`
- `tokens[].polarity` ∈ `PRO | CONS | NEUTRAL` — PRO=초록, CONS=빨강 (UI 규칙)
- `tokens[].reason` = 사유 아코디언 텍스트 (한국어)
- `churnAfter` = 이 턴 직후 이탈위험도 0-100

---

### 2.3 `onIndexUpdate` — 이탈위험도·감정 실시간 갱신

AGENT가 매 고객 턴 후 churn_risk 계산 + 감정 분류 결과를 emit.

```graphql
subscription OnIndexUpdate($callId: ID!) {
  onIndexUpdate(callId: $callId) {
    callId
    churnRisk
    emotion
  }
}
```

**샘플 페이로드**
```json
{
  "data": {
    "onIndexUpdate": {
      "callId": "01J9XXXXXXXXXXXXXX",
      "churnRisk": 72,
      "emotion": "불안"
    }
  }
}
```

- `churnRisk`: 0-100 정수. 키워드 가중치 계산 SSOT: `docs/reference/CHURN-RISK-LEXICON.md` + `docs/reference/churn_risk_lexicon.json` (TEAM-LOCK).
- `emotion`: 한국어 자연어 감정 레이블 (예: `"불안"`, `"관심"`, `"중립"`, `"저항"`).

---

### 2.4 `onSpeechAnalysis` — 발화 분석 토큰 스트리밍

발화 분석 카드①(SpeechAnalysis 컴포넌트) 갱신. AGENT가 발화 분류 후 토큰 배열 emit.

```graphql
subscription OnSpeechAnalysis($callId: ID!) {
  onSpeechAnalysis(callId: $callId) {
    callId
    turnSeq
    tokens {
      text
      polarity
      reason
    }
  }
}
```

**샘플 페이로드**
```json
{
  "data": {
    "onSpeechAnalysis": {
      "callId": "01J9XXXXXXXXXXXXXX",
      "turnSeq": 5,
      "tokens": [
        { "text": "금리가 높은 것 같아서", "polarity": "CONS", "reason": "금리 불만 직접 표현 — 이탈 위험 신호" },
        { "text": "한번 알아보려고요", "polarity": "NEUTRAL", "reason": "탐색 의향 표현" }
      ]
    }
  }
}
```

---

### 2.5 `onStrategyUpdate` — 상담 전략 갱신

카드②(StrategyPanel 컴포넌트) 갱신. AGENT가 매 턴 후 전략 headline + 근거 + 데이터 emit.

```graphql
subscription OnStrategyUpdate($callId: ID!) {
  onStrategyUpdate(callId: $callId) {
    callId
    turnSeq
    headline
    rationale
    data {
      live {
        lastIntent
      }
      static {
        creditScore
      }
    }
  }
}
```

**샘플 페이로드**
```json
{
  "data": {
    "onStrategyUpdate": {
      "callId": "01J9XXXXXXXXXXXXXX",
      "turnSeq": 5,
      "headline": "대환 시 월 4만원 절감 강조",
      "rationale": "고객이 타사 금리를 두 번 언급, 이탈 신호 — 절감액 구체화로 전환 유인",
      "data": {
        "live": { "lastIntent": "한도조회 요청" },
        "static": { "creditScore": 720 }
      }
    }
  }
}
```

> Next action 카드(구 카드③)는 제거됨. `headline`이 큰 텍스트(상단), `data` 칩이 보조(하단) — UI §3.2 (2c/2d).

---

### 2.6 `onComplianceState` — 컴플라이언스 루프 상태

CompliancePanel 컴포넌트 상태 전이. AGENT가 Bedrock Guardrails 루프 단계마다 emit.

```graphql
subscription OnComplianceState($callId: ID!) {
  onComplianceState(callId: $callId) {
    callId
    turnSeq
    state
    draft
    violatedPolicies
  }
}
```

**인자**: `callId: ID!`

**페이로드 필드**

| 필드 | 타입 | 설명 |
|---|---|---|
| `state` | `String!` | `drafting \| reviewing \| redacting \| redrafting \| approved` |
| `draft` | `String` | 현재 AI 답변 초안 텍스트 (텍스트창 표시용) |
| `violatedPolicies` | `[String]` | 위반 정책 목록 (redacting 단계에서만 비어있지 않음) |

**상태 전이 순서**
```
drafting → reviewing → (위반 없으면) approved
                     → (위반 시)    redacting → redrafting → reviewing → ... → approved
```

**샘플 페이로드 (redacting)**
```json
{
  "data": {
    "onComplianceState": {
      "callId": "01J9XXXXXXXXXXXXXX",
      "turnSeq": 7,
      "state": "redacting",
      "draft": "원금 보장이 가능한 상품입니다...",
      "violatedPolicies": ["원금보장 허위 표시 금지 (금융소비자보호법 §21)"]
    }
  }
}
```

---

### 2.7 `onMotDetected` — MOT 마커 감지

JourneyMap의 MOT 아이콘 + MotFloating 트리거. AGENT가 MOT 탐지 규칙(`docs/nextjs-aws-architecture.md` §6) 충족 시 emit.

```graphql
subscription OnMotDetected($callId: ID!) {
  onMotDetected(callId: $callId) {
    callId
    seq
    type
    turnSeq
    churnBefore
    churnAfter
    triggers
    strategy {
      tactic
      headline
    }
    outcome
    narrative
  }
}
```

**페이로드 필드**

| 필드 | 타입 | 설명 |
|---|---|---|
| `type` | `String!` | `RISK \| CONVERSION` |
| `turnSeq` | `Int!` | 해당 턴 시퀀스 |
| `churnBefore` | `Int!` | MOT 직전 이탈위험도 |
| `churnAfter` | `Int!` | MOT 직후 이탈위험도 |
| `triggers` | `[String!]!` | 탐지 키워드/의도 목록 |
| `strategy.tactic` | `String` | 전략 전술 |
| `strategy.headline` | `String` | 전략 헤드라인 |
| `outcome` | `String` | `defended \| converted \| lost` |
| `narrative` | `String` | MOT 요약 1줄 (한국어) |

**MOT 탐지 규칙** (`docs/nextjs-aws-architecture.md` §6):
- RISK: `churnAfter - churnBefore ≥ +12` 또는 `churnAfter ≥ 60`
- CONVERSION: `TRANSFER_INTENT` / `BUYING_INTENT` 매칭 턴

**샘플 페이로드**
```json
{
  "data": {
    "onMotDetected": {
      "callId": "01J9XXXXXXXXXXXXXX",
      "seq": 2,
      "type": "RISK",
      "turnSeq": 5,
      "churnBefore": 48,
      "churnAfter": 72,
      "triggers": ["다른 은행", "4.5%"],
      "strategy": {
        "tactic": "절감액 구체화",
        "headline": "대환 시 월 4만원 절감 강조"
      },
      "outcome": "defended",
      "narrative": "타사 금리 비교로 이탈 급등 → 절감액 구체화 후 방어 성공"
    }
  }
}
```

---

### 2.8 `onCallEnded` — 통화 종료

통화 종료 이벤트 → CRM 화면(`/crm/[id]`) 전환 트리거.

```graphql
subscription OnCallEnded($callId: ID!) {
  onCallEnded(callId: $callId) {
    callId
    resultType
    endedAt
  }
}
```

**페이로드 필드**

| 필드 | 타입 | 설명 |
|---|---|---|
| `resultType` | `String!` | `한도조회_상담원연결 \| 가입승인 \| 거절` |
| `endedAt` | `String!` | ISO-8601 UTC |

**샘플 페이로드**
```json
{
  "data": {
    "onCallEnded": {
      "callId": "01J9XXXXXXXXXXXXXX",
      "resultType": "한도조회_상담원연결",
      "endedAt": "2026-06-19T03:18:00Z"
    }
  }
}
```

---

## 3. GraphQL Queries (쿼리)

> 초기 로드 + 재연결 스냅샷 용도 (구 REST GET 엔드포인트 대체). 실시간 갱신은 §2 구독.

### 3.1 `queue` — 큐 스냅샷

관리자 대시보드 초기 로드.

```graphql
query Queue($highlightOnly: Boolean) {
  queue(highlightOnly: $highlightOnly) {
    summary {
      waiting
      inProgress
      needsAgent
      fraudSuspected
      ended
    }
    rows {
      callId
      customerId
      customerName
      targetProduct
      state
      scenario
      highlight
      highlightSince
      elapsedSec
    }
  }
}
```

**인자**: `highlightOnly: Boolean` (기본 `false` — 전체 목록)

---

### 3.2 `call` — 통화 모니터링 스냅샷

상담 화면(`/calls/[id]`) 초기 로드 및 재연결 시 전체 상태 복원. 구독 연결 전 또는 재연결 시 사용.

```graphql
query Call($id: ID!) {
  call(id: $id) {
    id
    state
    scenario
    fraudSuspected
    startedAt
    endedAt
    agentJoinedAt
    customer {
      id
      name
      phone
      targetProduct
      rate
      limit
      existingLoans { own other }
      hasVehicle
      creditScore
      persona { tone needs }
    }
    analysis {
      churnRisk
      emotion
      aiAction { comment action }
      rationale
      data {
        live { lastIntent }
        static { creditScore }
      }
      strategyHeadline
    }
    transcript {
      seq
      speaker
      text
      node
      churnAfter
      tokens { text polarity reason }
    }
    currentNode
  }
}
```

**반환 구성**

| 필드 그룹 | 설명 |
|---|---|
| `call.*` (루트) | 콜 메타: state·scenario·fraud_suspected·시각 |
| `customer` | 고객 정보 패널: 페르소나·금융 정보 |
| `analysis` | AI 분석 패널: churnRisk·emotion·aiAction·rationale·data·strategyHeadline |
| `transcript[]` | 전체 발화 이력 (Turn 배열, §3.4) |
| `currentNode` | 현재 LangGraph 노드 ID |

**샘플 응답 (요약)**
```json
{
  "data": {
    "call": {
      "id": "01J9XXXXXXXXXXXXXX",
      "state": "IN_CALL",
      "scenario": "S1",
      "fraudSuspected": false,
      "startedAt": "2026-06-19T03:00:05Z",
      "endedAt": null,
      "agentJoinedAt": null,
      "customer": {
        "id": "01H9XXXXXXXXXXXXXX",
        "name": "김영수",
        "targetProduct": "대환대출",
        "rate": "연 5.9%",
        "limit": 50000000,
        "existingLoans": { "own": 12000000, "other": 8000000 },
        "hasVehicle": true,
        "creditScore": 720,
        "persona": { "tone": "신중함", "needs": ["금리 비교"] }
      },
      "analysis": {
        "churnRisk": 72,
        "emotion": "불안",
        "aiAction": { "comment": "대환 시 월 4만원 절감 강조", "action": "OFFER_COMPARISON" },
        "rationale": "고객이 타사 금리를 두 번 언급, 이탈 신호",
        "data": {
          "live": { "lastIntent": "한도조회 요청" },
          "static": { "creditScore": 720 }
        },
        "strategyHeadline": "대환 시 월 4만원 절감 강조"
      },
      "transcript": [
        {
          "seq": 1, "speaker": "bot",
          "text": "안녕하세요, 저는 AI 상담 도우미입니다.",
          "node": "greeting", "churnAfter": 30,
          "tokens": []
        }
      ],
      "currentNode": "classify"
    }
  }
}
```

---

### 3.3 `customer` / `customers` — 고객 정보

```graphql
query Customer($id: ID!) {
  customer(id: $id) {
    id
    name
    phone
    targetProduct
    rate
    limit
    existingLoans { own other }
    hasVehicle
    creditScore
    persona { tone needs }
    scenarioHint
  }
}

query Customers {
  customers {
    id
    name
    targetProduct
    state
  }
}
```

- `customer(id)`: 단일 고객 전체 정보. 에러: `NOT_FOUND`.
- `customers`: 시드된 데모 고객 목록 (10명). 큐 목록·세그먼트 선택용.

---

### 3.4 `products` — 상품 목록

```graphql
query Products {
  products {
    id
    name
    description
    monthlyFee
  }
}
```

승인 대상 상품 목록. ProductApproval 컴포넌트 초기 로드용.

---

### 3.5 `mots` — MOT 목록 (통화 중 CRM 보드)

통화 중 또는 종료 후 MOT 타임라인 전체 조회.

```graphql
query Mots($callId: ID!) {
  mots(callId: $callId) {
    callId
    seq
    type
    turnSeq
    churnBefore
    churnAfter
    triggers
    strategy { tactic headline }
    outcome
    narrative
  }
}
```

**인자**: `callId: ID!`

---

### 3.6 `callSummary` — 통화 종료·인계 요약

CRM 화면(`/crm/[id]`) 초기 로드. `endCall` 뮤테이션 후 Lambda가 생성.

```graphql
query CallSummary($id: ID!) {
  callSummary(id: $id) {
    id
    callId
    resultType
    content
    flow
    categories
    createdAt
    handoffReason
    fraudSuspected
    transcript {
      seq
      speaker
      text
      highlight
      tokens { text polarity reason }
    }
    mots {
      seq
      type
      turnSeq
      churnBefore
      churnAfter
      outcome
      narrative
    }
  }
}
```

**반환 구성**

| 필드 | 설명 |
|---|---|
| `resultType` | `한도조회_상담원연결 \| 가입승인 \| 거절` |
| `content` | AI 종합 요약 (한국어, 고객 반응·주요 발화·최종 의사) |
| `flow` | 상담 flow 요약 (노드 경로 배열) |
| `categories` | 카테고리 태그 배열 |
| `handoffReason` | 상담원 연결 사유 (한국어) |
| `fraudSuspected` | 통화 중 금융사기 의심 여부 (요약 화면 표시용, 종료와 무관) |
| `transcript[]` | 전체 발화 + 중요 발화 `highlight: true` |
| `mots[]` | 통화 전체 MOT 요약 (CRM MotBoard용) |

**샘플 응답**
```json
{
  "data": {
    "callSummary": {
      "id": "01S9XXXXXXXXXXXXXX",
      "callId": "01J9XXXXXXXXXXXXXX",
      "resultType": "한도조회_상담원연결",
      "content": "고객은 대환대출 금리에 관심을 가지고 타사 비교를 요청. 절감액 제시 후 한도조회 요청으로 상담원 연결됨.",
      "flow": ["greeting", "intro_product", "classify", "offer_comparison", "transfer_to_agent"],
      "categories": ["대환대출", "한도조회", "상담원연결"],
      "createdAt": "2026-06-19T03:18:05Z",
      "handoffReason": "고객 한도조회 요청 → 상담원 연결",
      "fraudSuspected": false,
      "transcript": [
        { "seq": 1, "speaker": "bot", "text": "안녕하세요...", "highlight": false, "tokens": [] },
        { "seq": 5, "speaker": "customer", "text": "다른 은행은 4.5% 준다던데 여기는 얼마에요?", "highlight": true,
          "tokens": [{ "text": "다른 은행", "polarity": "CONS", "reason": "타사 비교 언급" }] }
      ],
      "mots": [
        { "seq": 1, "type": "RISK", "turnSeq": 5, "churnBefore": 48, "churnAfter": 72,
          "outcome": "defended", "narrative": "타사 금리 비교로 이탈 급등 → 절감액 제시로 방어" },
        { "seq": 2, "type": "CONVERSION", "turnSeq": 14, "churnBefore": 35, "churnAfter": 20,
          "outcome": "converted", "narrative": "한도조회 의향 표명 → 상담원 연결 전환" }
      ]
    }
  }
}
```

---

## 4. GraphQL SDL 스니펫 (machine-readable 계약 참조)

> **SSOT**: `graphql/schema.graphql` (BACKEND 소유, `docs/MODULES.md` §2.1).
> 아래는 주요 타입·오퍼레이션의 SDL 요약입니다. 전체 정의는 `graphql/schema.graphql`을 참조하세요.

```graphql
# ── 스칼라 / 기본 타입 ──────────────────────────────────────────

scalar AWSJSON
scalar AWSDateTime

# ── 도메인 타입 ─────────────────────────────────────────────────

type Call {
  id: ID!
  customerId: ID!
  state: CallState!
  scenario: String!
  fraudSuspected: Boolean!
  startedAt: AWSDateTime!
  endedAt: AWSDateTime
  agentJoinedAt: AWSDateTime
}

enum CallState {
  DIALING
  RINGING
  ACCEPTED
  REJECTED
  IN_CALL
  TRANSFER_PENDING
  AGENT_JOINED
  ENDED
}

type Customer {
  id: ID!
  name: String!
  phone: String
  targetProduct: String!
  rate: String
  limit: Int
  existingLoans: ExistingLoans
  hasVehicle: Boolean
  creditScore: Int
  persona: Persona
  scenarioHint: String
}

type ExistingLoans { own: Int  other: Int }
type Persona       { tone: String  needs: [String] }

type Token {
  text:     String!
  polarity: Polarity!
  reason:   String
}

enum Polarity { PRO  CONS  NEUTRAL }

type Turn {
  callId:     ID!
  seq:        Int!
  speaker:    Speaker!
  text:       String!
  node:       String
  churnAfter: Int
  tokens:     [Token!]!
}

enum Speaker { bot  customer  agent }

type MOT {
  callId:     ID!
  seq:        Int!
  type:       MotType!
  turnSeq:    Int!
  churnBefore: Int!
  churnAfter:  Int!
  triggers:    [String!]!
  strategy:    MotStrategy
  outcome:     MotOutcome
  narrative:   String
}

enum MotType    { RISK  CONVERSION }
enum MotOutcome { defended  converted  lost }
type MotStrategy { tactic: String  headline: String }

type ComplianceReview {
  callId:           ID!
  turnSeq:          Int!
  tryIndex:         Int!
  draft:            String!
  verdict:          String!
  violatedPolicies: [String!]!
  action:           String!
}

type Summary {
  id:            ID!
  callId:        ID!
  resultType:    String!
  content:       String!
  flow:          [String!]!
  categories:    [String!]!
  createdAt:     AWSDateTime!
  handoffReason: String
  fraudSuspected: Boolean!
}

type Product {
  id:          ID!
  name:        String!
  description: String
  monthlyFee:  Int
}

type Analysis {
  churnRisk:       Int!
  emotion:         String
  aiAction:        AiAction
  rationale:       String
  data:            AnalysisData
  strategyHeadline: String
}

type AiAction    { comment: String  action: String }
type AnalysisData { live: AWSJSON  static: AWSJSON }

type QueueSummary {
  waiting:       Int!
  inProgress:    Int!
  needsAgent:    Int!
  fraudSuspected: Int!
  ended:         Int!
}

type QueueRow {
  callId:       ID!
  customerId:   ID!
  customerName: String!
  targetProduct: String!
  state:        CallState!
  scenario:     String!
  highlight:    String
  highlightSince: AWSDateTime
  elapsedSec:   Int!
}

type QueueResult    { summary: QueueSummary!  rows: [QueueRow!]! }
type ApproveResult  { approved: Boolean!  productId: ID!  callId: ID! }
type SendLinkResult { sent: Boolean!  callId: ID!  url: String! }
type CallEndedEvent { callId: ID!  resultType: String!  endedAt: AWSDateTime! }

type CallSnapshot {
  id:          ID!
  state:       CallState!
  scenario:    String!
  fraudSuspected: Boolean!
  startedAt:   AWSDateTime!
  endedAt:     AWSDateTime
  agentJoinedAt: AWSDateTime
  customer:    Customer!
  analysis:    Analysis!
  transcript:  [Turn!]!
  currentNode: String
}

type CallSummaryResult {
  id:            ID!
  callId:        ID!
  resultType:    String!
  content:       String!
  flow:          [String!]!
  categories:    [String!]!
  createdAt:     AWSDateTime!
  handoffReason: String
  fraudSuspected: Boolean!
  transcript:    [SummaryTurn!]!
  mots:          [MOT!]!
}

type SummaryTurn {
  seq:       Int!
  speaker:   Speaker!
  text:      String!
  highlight: Boolean!
  tokens:    [Token!]!
}

type IndexUpdateEvent {
  callId:    ID!
  churnRisk: Int!
  emotion:   String
}

type SpeechAnalysisEvent {
  callId:   ID!
  turnSeq:  Int!
  tokens:   [Token!]!
}

type StrategyUpdateEvent {
  callId:    ID!
  turnSeq:   Int!
  headline:  String!
  rationale: String
  data:      AnalysisData
}

type ComplianceStateEvent {
  callId:           ID!
  turnSeq:          Int!
  state:            String!
  draft:            String
  violatedPolicies: [String!]
}

# ── Query ────────────────────────────────────────────────────────

type Query {
  queue(highlightOnly: Boolean):  QueueResult!
  call(id: ID!):                  CallSnapshot!
  customer(id: ID!):              Customer!
  customers:                      [Customer!]!
  products:                       [Product!]!
  mots(callId: ID!):              [MOT!]!
  callSummary(id: ID!):           CallSummaryResult!
}

# ── Mutation ─────────────────────────────────────────────────────

type Mutation {
  createCall(customerId: ID!, scenarioHint: String):         Call!
  dialCall(customerId: ID!):                                  Call!
  nextTurn(callId: ID!):                                      Turn!
  endCall(callId: ID!):                                       Call!
  approveProduct(callId: ID!, productId: ID!):                ApproveResult!
  transferToAgent(callId: ID!):                               Call!
  sendLink(callId: ID!, url: String!):                        SendLinkResult!
}

# ── Subscription ─────────────────────────────────────────────────

type Subscription {
  onQueueUpdate:                              QueueResult
    @aws_subscribe(mutations: ["updateQueue"])

  onTurn(callId: ID!):                        Turn
    @aws_subscribe(mutations: ["nextTurn", "_emitTurn"])

  onIndexUpdate(callId: ID!):                 IndexUpdateEvent
    @aws_subscribe(mutations: ["_emitIndexUpdate"])

  onSpeechAnalysis(callId: ID!):              SpeechAnalysisEvent
    @aws_subscribe(mutations: ["_emitSpeechAnalysis"])

  onStrategyUpdate(callId: ID!):              StrategyUpdateEvent
    @aws_subscribe(mutations: ["_emitStrategyUpdate"])

  onComplianceState(callId: ID!):             ComplianceStateEvent
    @aws_subscribe(mutations: ["_emitComplianceState"])

  onMotDetected(callId: ID!):                 MOT
    @aws_subscribe(mutations: ["_emitMot"])

  onCallEnded(callId: ID!):                   CallEndedEvent
    @aws_subscribe(mutations: ["endCall", "_emitCallEnded"])
}
```

> `_emit*` 뮤테이션은 Lambda orchestrator(AGENT)가 DynamoDB write 후 Streams → AppSync 팬아웃 시 내부적으로 사용하는 트리거 진입점입니다. FRONTEND가 직접 호출하지 않습니다.

---

## 5. 데이터 모델 / Data Models

> 저장소: **DynamoDB 싱글 테이블 (+Streams)**. PK/SK 설계·마샬링 SSOT: `lambda/orchestrator/models/*` (DATA 소유).
> JSON 표현은 camelCase (GraphQL/프론트), DynamoDB 저장은 snake_case.
> ~~DuckDB~~는 폐기됨.

### 5.1 Customer

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string (ULID) | PK: `CUST#{id}` |
| `name` | string | 고객명 |
| `phone` | string | 전화번호 |
| `targetProduct` | string | 대상 상품 |
| `rate` | string | 금리 (예: `"연 5.9%"`) |
| `limit` | int | 한도 (원) |
| `existingLoans` | `{own:int, other:int}` | 당사/타사 기존 대출 |
| `hasVehicle` | bool | 차량 보유 여부 |
| `creditScore` | int | 신용점수 |
| `persona` | object | `{tone:string, needs:string[]}` |
| `scenarioHint` | `S1\|null` | 데모/테스트용 힌트 |

### 5.2 Call

DynamoDB: PK=`CALL#{id}`, SK=`META`

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string (ULID) | 콜 식별자 |
| `customerId` | string (ULID) | 고객 참조 |
| `state` | enum | Call 상태 머신 (§0.2) |
| `scenario` | `S1` | 시나리오 코드 |
| `fraudSuspected` | bool | 금융사기 의심 플래그 (표시용, 종료 무관) |
| `startedAt` | ISO-8601 | 발신 시각 |
| `endedAt` | ISO-8601\|null | 종료 시각 |
| `agentJoinedAt` | ISO-8601\|null | 상담원 합류 시각 |

### 5.3 Turn (구 Transcript)

DynamoDB: PK=`CALL#{id}`, SK=`TURN#{seq:0-pad}`

| 필드 | 타입 | 설명 |
|---|---|---|
| `seq` | int | 발화 순번 (1부터) |
| `speaker` | `bot\|customer\|agent` | 화자 |
| `text` | string | 발화 내용 (한국어) |
| `node` | string | LangGraph 노드 ID |
| `churnAfter` | int | 이 턴 직후 이탈위험도 0-100 |
| `tokens` | `[{text,polarity,reason}]` | 분석 토큰 배열 |

> `polarity` ∈ `PRO | CONS | NEUTRAL`. PRO=초록(`.k-go`), CONS=빨강(`.k-risk`).
> `reason` = 사유 아코디언 텍스트 (한국어, 키워드 클릭 시 확장).

### 5.4 MOT (Moment of Truth) — 신규

DynamoDB: PK=`CALL#{id}`, SK=`MOT#{seq:0-pad}`

| 필드 | 타입 | 설명 |
|---|---|---|
| `seq` | int | MOT 순번 |
| `type` | `RISK\|CONVERSION` | MOT 유형 |
| `turnSeq` | int | 해당 발화 시퀀스 |
| `churnBefore` | int | MOT 직전 이탈위험도 |
| `churnAfter` | int | MOT 직후 이탈위험도 |
| `triggers` | string[] | 탐지 키워드/의도 |
| `strategy` | `{tactic,headline}` | 적용 전략 |
| `outcome` | `defended\|converted\|lost` | 결과 |
| `narrative` | string | MOT 요약 1줄 (한국어) |

### 5.5 ComplianceReview — 신규

DynamoDB: PK=`CALL#{id}`, SK=`CMPL#{turnSeq}#{tryIndex}`

| 필드 | 타입 | 설명 |
|---|---|---|
| `turnSeq` | int | 해당 발화 시퀀스 |
| `tryIndex` | int | 재작성 시도 횟수 (0-based) |
| `draft` | string | AI 초안 텍스트 |
| `verdict` | string | Guardrails 판정 |
| `violatedPolicies` | string[] | 위반 정책 목록 |
| `action` | `approved\|rewritten` | 최종 처리 |

### 5.6 Summary

DynamoDB: PK=`CALL#{id}`, SK=`SUMMARY`

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string (ULID) | 요약 식별자 |
| `callId` | string (ULID) | 콜 참조 |
| `resultType` | string | `한도조회_상담원연결\|가입승인\|거절` |
| `content` | string | AI 종합 요약 (한국어) |
| `flow` | string[] | 상담 노드 경로 |
| `categories` | string[] | 카테고리 태그 |
| `handoffReason` | string | 상담원 연결 사유 |
| `fraudSuspected` | bool | 금융사기 의심 여부 |
| `createdAt` | ISO-8601 | 생성 시각 |

### 5.7 Product

DynamoDB: PK=`PROD#{id}`, SK=`META`

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 상품 식별자 |
| `name` | string | 상품명 |
| `description` | string | 상품 설명 |
| `monthlyFee` | int | 월 예상 비용 (원) |

---

## 6. 오퍼레이션 ↔ 화면 ↔ 모듈 매핑 / Operation Map

> FRONTEND 소유(화면) / BACKEND 소유(GraphQL 스키마) / AGENT 생산(분석 이벤트 값) / DATA 소유(DynamoDB 모델)

| 화면 | Query (초기 로드) | Mutation (액션) | Subscription (실시간) | 화면 owner | 데이터 provider |
|---|---|---|---|---|---|
| **관리자 대시보드** | `queue` | — | `onQueueUpdate` | FRONTEND | BACKEND |
| **사전 고객분석** (세그먼트) | `customer`, `customers` | `createCall` (분석), `dialCall` (통화 버튼) | — | FRONTEND | BACKEND |
| **실시간 상담 모니터링** | `call`, `products`, `mots` | `approveProduct`, `transferToAgent`, `sendLink`, `endCall` | `onTurn`, `onIndexUpdate`, `onSpeechAnalysis`, `onStrategyUpdate`, `onComplianceState`, `onMotDetected`, `onCallEnded` | FRONTEND | BACKEND + AGENT |
| **통화 종료·인계 요약** (CRM + MOT 보드) | `callSummary` | — | (`onCallEnded` → 화면 전환 트리거) | FRONTEND | BACKEND + AGENT |

> 새 오퍼레이션/이벤트 추가 시: 본 문서 + `graphql/schema.graphql` + `docs/MODULES.md` §5 + `frontend/src/types/*` 동시 갱신 → **BACKEND PR**.

---

## 7. Out of Scope (API 레벨)

`data/consult_merged-4.html` 및 `docs/nextjs-aws-architecture.md` §2.2와 일치:

- API 키 이외의 인증·인가 헤더·토큰·세션 — 없음 (부스 데모, 단일 상담원).
- 실제 SMS/이메일/푸시 발송 — `sendLink`는 기록만.
- 실제 전화망/PSTN/Twilio — 오디오는 라이브 모드에서 노트북 마이크를 Lambda+Transcribe로, 스크립트 모드에서 `scenario.json` 재생.
- 멀티테넌시/페이지네이션/rate-limit — 단일 부스 데모 범위.
- 외부 금융/신용 API — `Customer` 데이터는 시드 가상 데이터.
- ~~FastAPI~~ / ~~DuckDB~~ / ~~`/api/...` REST 경로~~ / ~~`/ws/agent`~~ / ~~`/ws/audio`~~ — 모두 AppSync GraphQL로 대체됨.
