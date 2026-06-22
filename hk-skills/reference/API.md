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
>
> **[2026-06-22 SSOT-3 정합 업데이트]** MOT 형상·턴 flag·전략 카드·컴플라이언스 페이로드가
> `docs/consult_redesigned-3.html` (UI SSOT-3) 및 이슈 #28 확정 계약에 따라 전면 재정렬되었습니다.
> 정확한 타입/enum은 `graphql/schema.graphql`이 기준입니다.

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
    seq
    speaker
    text
    node
    churnAfter
    flag
    tokens {
      text
      polarity
      reason
    }
  }
}
```

**인자**: `callId: ID!`

**반환**: `Turn` (§5.3). 동시에 `onTurn` 구독으로도 브로드캐스트됨.

**샘플 응답**
```json
{
  "data": {
    "nextTurn": {
      "seq": 3,
      "speaker": "customer",
      "text": "다른 은행은 4.5% 준다던데 여기는 얼마에요?",
      "node": "classify",
      "churnAfter": 68,
      "flag": "RISK",
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
    ok
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
      "ok": true,
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
    ok
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
      "ok": true,
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
    flag
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
      "flag": null,
      "tokens": [
        { "text": "월 약 4만원 절감", "polarity": "PRO", "reason": "절감 효과 구체적 제시 — 전환 유인" }
      ]
    }
  }
}
```

- `speaker` ∈ `bot | customer | agent`
- `flag` ∈ `RISK | DEF | NEUTRAL | null` — 턴 레벨 플래그 배지 (`.flag--risk` / `.flag--def`). null = NEUTRAL.
- `tokens[].polarity` ∈ `PRO | CONS | NEUTRAL` — 키워드 폰트 강조 전용 (색상 매핑 아님)
- `tokens[].reason` = 선택된 전략 카드의 리드 텍스트와 연결되는 분류 근거 (한국어)
- `churnAfter` = 이 턴 직후 이탈위험도 0-100 (TurnPayload에는 포함되지 않음 — `onIndexUpdate`로 수신)

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

### 2.4 `onSpeechAnalysis` — 발화 분석 결과 스트리밍

발화 분석 카드①(SpeechAnalysis 컴포넌트) 갱신. AGENT가 발화 분류 후 극성·근거·플래그 emit.

```graphql
subscription OnSpeechAnalysis($callId: ID!) {
  onSpeechAnalysis(callId: $callId) {
    callId
    turnId
    polarity
    reason
    turnFlag
  }
}
```

**페이로드 필드**

| 필드 | 타입 | 설명 |
|---|---|---|
| `turnId` | `ID` | 해당 발화 식별자 |
| `polarity` | `Polarity` | `PRO \| CONS \| NEUTRAL` — 전체 턴 극성 |
| `reason` | `String` | 분류 근거 (선택된 전략 카드 리드 텍스트와 연결) |
| `turnFlag` | `TurnFlag` | `RISK \| DEF \| NEUTRAL` — 턴 레벨 플래그 배지 |

**샘플 페이로드**
```json
{
  "data": {
    "onSpeechAnalysis": {
      "callId": "01J9XXXXXXXXXXXXXX",
      "turnId": "5",
      "polarity": "CONS",
      "reason": "금리 불만 직접 표현 — 이탈 위험 신호",
      "turnFlag": "RISK"
    }
  }
}
```

---

### 2.5 `onStrategyUpdate` — 상담 전략 갱신

카드① STRAT20 갱신 (`.stx` / `.slead`). AGENT가 매 턴 후 전략 headline + 근거 2필드만 emit.
별도 StrategyPanel 컴포넌트는 없습니다 — 전략은 카드① 안에 인라인으로 표시됩니다.

```graphql
subscription OnStrategyUpdate($callId: ID!) {
  onStrategyUpdate(callId: $callId) {
    callId
    strategyHeadline
    rationale
  }
}
```

**페이로드 필드**

| 필드 | 타입 | 설명 |
|---|---|---|
| `strategyHeadline` | `String!` | 전략 한 줄 요약 (카드① `.stx` 바인딩) |
| `rationale` | `String!` | 전략 근거 (카드① `.slead` 바인딩) |

**샘플 페이로드**
```json
{
  "data": {
    "onStrategyUpdate": {
      "callId": "01J9XXXXXXXXXXXXXX",
      "strategyHeadline": "대환 시 월 4만원 절감 강조",
      "rationale": "고객이 타사 금리를 두 번 언급, 이탈 신호 — 절감액 구체화로 전환 유인"
    }
  }
}
```

---

### 2.6 `onComplianceState` — 컴플라이언스 루프 상태

CompliancePanel 컴포넌트 상태 전이. AGENT가 Bedrock Guardrails 루프 단계마다 emit.

```graphql
subscription OnComplianceState($callId: ID!) {
  onComplianceState(callId: $callId) {
    callId
    state
    draft
    violatedPolicies {
      id
      label
      passed
    }
    finalDiff
  }
}
```

**인자**: `callId: ID!`

**페이로드 필드**

| 필드 | 타입 | 설명 |
|---|---|---|
| `state` | `ComplianceStateEnum!` | `DRAFTING \| REVIEWING \| REDACTING \| REDRAFTING \| APPROVED` |
| `draft` | `String` | 현재 AI 답변 초안 텍스트 (텍스트창 표시용) |
| `violatedPolicies` | `[PolicyCheck!]!` | 위반 정책 목록 (`{id, label, passed}` — redacting 단계에서 `passed: false` 항목 비어있지 않음) |
| `finalDiff` | `String` | 최종 승인 시 원본↔수정 diff (APPROVED 단계에서만 설정) |

**상태 전이 순서**
```
DRAFTING → REVIEWING → (위반 없으면) APPROVED
                     → (위반 시)    REDACTING → REDRAFTING → REVIEWING → ... → APPROVED
```

**샘플 페이로드 (REDACTING)**
```json
{
  "data": {
    "onComplianceState": {
      "callId": "01J9XXXXXXXXXXXXXX",
      "state": "REDACTING",
      "draft": "원금 보장이 가능한 상품입니다...",
      "violatedPolicies": [
        { "id": "POL-021", "label": "원금보장 허위 표시 금지 (금융소비자보호법 §21)", "passed": false }
      ],
      "finalDiff": null
    }
  }
}
```

---

### 2.7 `onMotDetected` — MOT 마커 감지

CRM `.sum-flow` 4단계 인라인 표시 트리거. AGENT가 MOT 탐지 규칙 충족 시 emit.
MOT는 `stage` 필드로 CRM `.sum-flow` 4단계(신뢰쌓기/우려풀기/담보오해/전환맺기)에 매핑됩니다 — 별도 MotBoard 컴포넌트 없음.

```graphql
subscription OnMotDetected($callId: ID!) {
  onMotDetected(callId: $callId) {
    callId
    markerId
    state
    stage
  }
}
```

**페이로드 필드**

| 필드 | 타입 | 설명 |
|---|---|---|
| `markerId` | `MotMarkerId!` | `MOT_1 \| MOT_2 \| MOT_3 \| MOT_4 \| MOT_5` |
| `state` | `MotState!` | `SHOW \| ALERT \| BLOCKED` |
| `stage` | `MotStage!` | `TRUST \| OBJECTION \| COLLATERAL \| CLOSE` (CRM sum-flow 4단계 매핑) |

**MOT 탐지 참고** (`docs/nextjs-aws-architecture.md` §6):
- `ALERT` 전이: `churnAfter ≥ 60` 또는 이탈위험도 급등 감지
- `BLOCKED` 전이: `BUYING_INTENT` / `TRANSFER_INTENT` 매칭 후 전환 확정

> `markerId`의 `MOT_1`~`MOT_5` 코드는 wire 필드입니다. rz-rate/compare/pay/security/avoid 같은 이름은 FRONTEND DOM 매핑 전용이며 wire에 전송되지 않습니다.

**샘플 페이로드**
```json
{
  "data": {
    "onMotDetected": {
      "callId": "01J9XXXXXXXXXXXXXX",
      "markerId": "MOT_2",
      "state": "ALERT",
      "stage": "OBJECTION"
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
    call {
      id
      state
      scenario
      fraudSuspected
      startedAt
      endedAt
      agentJoinedAt
    }
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
    }
    analysis {
      strategyHeadline
      rationale
      churnRisk
      emotion
    }
    transcript {
      seq
      speaker
      text
      node
      churnAfter
      flag
      tokens { text polarity reason }
    }
    currentNode
  }
}
```

**반환 구성**

| 필드 그룹 | 설명 |
|---|---|
| `call.*` (루트) | 콜 메타: state·scenario·fraudSuspected·시각 |
| `customer` | 고객 정보 패널: 금융 정보 |
| `analysis` | AI 분석 스냅샷: `strategyHeadline`·`rationale`·`churnRisk`·`emotion` 4필드 (§5.8) |
| `transcript[]` | 전체 발화 이력 (Turn 배열, §5.3) |
| `currentNode` | 현재 LangGraph 노드 ID |

**샘플 응답 (요약)**
```json
{
  "data": {
    "call": {
      "call": {
        "id": "01J9XXXXXXXXXXXXXX",
        "state": "IN_CALL",
        "scenario": "S1",
        "fraudSuspected": false,
        "startedAt": "2026-06-19T03:00:05Z",
        "endedAt": null,
        "agentJoinedAt": null
      },
      "customer": {
        "id": "01H9XXXXXXXXXXXXXX",
        "name": "김영수",
        "targetProduct": "대환대출",
        "rate": "연 5.9%",
        "limit": 50000000,
        "existingLoans": { "own": 12000000, "other": 8000000 },
        "hasVehicle": true,
        "creditScore": 720
      },
      "analysis": {
        "strategyHeadline": "대환 시 월 4만원 절감 강조",
        "rationale": "고객이 타사 금리를 두 번 언급, 이탈 신호",
        "churnRisk": 72,
        "emotion": "불안"
      },
      "transcript": [
        {
          "seq": 1, "speaker": "bot",
          "text": "안녕하세요, 저는 AI 상담 도우미입니다.",
          "node": "greeting", "churnAfter": 30,
          "flag": null,
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

### 3.5 `mots` — MOT 목록 (CRM sum-flow 인라인)

통화 중 또는 종료 후 MOT 전체 조회. CRM `.sum-flow` 4단계에 `stage`로 매핑됩니다.

```graphql
query Mots($callId: ID!) {
  mots(callId: $callId) {
    markerId
    state
    stage
    turnSeq
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
    strategyHeadline
    strategyLead
    mots {
      markerId
      state
      stage
      turnSeq
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
| `strategyHeadline` | 최종 전략 한 줄 요약 |
| `strategyLead` | 최종 전략 근거 리드 텍스트 |
| `mots[]` | 통화 전체 MOT 목록 (CRM `.sum-flow` 4단계에 `stage`로 인라인 매핑) |

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
      "strategyHeadline": "대환 시 월 4만원 절감 강조",
      "strategyLead": "타사 금리 비교 신호에 절감액 구체화로 전환 유인",
      "mots": [
        { "markerId": "MOT_2", "state": "ALERT", "stage": "OBJECTION", "turnSeq": 5 },
        { "markerId": "MOT_5", "state": "SHOW",  "stage": "CLOSE",     "turnSeq": 14 }
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
# SSOT: graphql/schema.graphql (BACKEND 소유). 아래는 주요 타입 요약 — 전체는 원본 파일 참조.
# [2026-06-22 SSOT-3 정합] MOT/TurnFlag/Analysis/Strategy/Compliance 형상 재정렬.

# ── Enums ────────────────────────────────────────────────────────

enum CallState { CREATED DIALING IN_CALL TRANSFER_PENDING ENDED }

enum Polarity { PRO CONS NEUTRAL }

# 턴 레벨 flag 배지 (.flag--risk / .flag--def). null→NEUTRAL.
enum TurnFlag { RISK DEF NEUTRAL }

# MOT (Moment of Truth) — SSOT-3 신규 형상.
enum MotMarkerId { MOT_1 MOT_2 MOT_3 MOT_4 MOT_5 }
enum MotState    { SHOW ALERT BLOCKED }
enum MotStage    { TRUST OBJECTION COLLATERAL CLOSE }

# 컴플라이언스 상태머신.
enum ComplianceStateEnum { DRAFTING REVIEWING REDACTING REDRAFTING APPROVED }

# ── 도메인 타입 ─────────────────────────────────────────────────

type Call {
  id: ID!
  customerId: String
  state: CallState
  scenario: String
  fraudSuspected: Boolean
  startedAt: String
  endedAt: String
  agentJoinedAt: String
}

type Customer {
  id: ID!
  name: String
  phone: String
  targetProduct: String
  rate: String
  limit: Int
  existingLoans: ExistingLoans
  hasVehicle: Boolean
  creditScore: Int
  scenarioHint: String
}

type ExistingLoans { own: Int  other: Int }

type Token {
  text:     String!
  polarity: Polarity
  reason:   String
}

type Turn {
  seq:        Int!
  speaker:    String
  text:       String
  node:       String
  churnAfter: Int
  flag:       TurnFlag
  tokens:     [Token!]
}

# call 스냅샷의 analysis (SSOT-3): 4필드만.
# 폐기 필드: aiAction, data(live/static), AnalysisData — 사용하지 마십시오.
type Analysis {
  strategyHeadline: String
  rationale:        String
  churnRisk:        Float
  emotion:          String
}

type CallSnapshot {
  call:         Call!
  customer:     Customer
  analysis:     Analysis
  transcript:   [Turn!]!
  currentNode:  String
}

# MOT — 신규 형상 (markerId/state/stage/turnSeq).
# 폐기 필드: type(RISK|CONVERSION), churnBefore, triggers, strategy, outcome,
#            narrative, MotType enum — 사용하지 마십시오.
type MOT {
  markerId: MotMarkerId!
  state:    MotState!
  stage:    MotStage!
  turnSeq:  Int!
}

type ComplianceReview {
  callId:           ID!
  turnSeq:          Int!
  tryIndex:         Int!
  draft:            String!
  verdict:          String!
  violatedPolicies: [String!]!
  action:           String!
}

type PolicyCheck { id: ID!, label: String!, passed: Boolean! }

type QueueSummary { total: Int!, needsAgent: Int!, fraudSuspected: Int!, inCall: Int! }

type QueueRow {
  callId:      ID!
  customerName: String
  state:        CallState
  stage:        String
  churnRisk:    Int
  assignee:     String
  channel:      String
  elapsedSec:   Int
  highlight:    String
}

type QueueResult { summary: QueueSummary!  rows: [QueueRow!]! }

type CallSummaryResult {
  id:               ID!
  callId:           ID!
  resultType:       String
  content:          String
  flow:             [String!]
  categories:       [String!]
  handoffReason:    String
  fraudSuspected:   Boolean
  strategyHeadline: String
  strategyLead:     String
  createdAt:        String
  mots:             [MOT!]!
}

type ApproveResult  { ok: Boolean!  callId: ID!  productId: ID }
type SendLinkResult { ok: Boolean!  callId: ID!  url: String! }

# ── Subscription 페이로드 타입 ──────────────────────────────────

type TurnPayload {
  callId:  ID!
  seq:     Int
  speaker: String
  text:    String
  flag:    TurnFlag
  tokens:  [Token!]
}

type IndexUpdatePayload  { callId: ID!, churnRisk: Int, emotion: String }

type SpeechAnalysisPayload {
  callId:   ID!
  turnId:   ID
  polarity: Polarity
  reason:   String
  turnFlag: TurnFlag
}

# 별도 StrategyPanel 없음 — 2필드로 단순화 (카드① .stx/.slead).
type StrategyUpdatePayload { callId: ID!, strategyHeadline: String!, rationale: String! }

type ComplianceStatePayload {
  callId:           ID!
  state:            ComplianceStateEnum!
  draft:            String
  violatedPolicies: [PolicyCheck!]!
  finalDiff:        String
}

type MotDetectedPayload {
  callId:   ID!
  markerId: MotMarkerId!
  state:    MotState!
  stage:    MotStage!
}

type QueueUpdatePayload { callId: ID!, state: CallState }
type CallEndedPayload   { callId: ID! }

# ── Query ────────────────────────────────────────────────────────

type Query {
  queue(highlightOnly: Boolean): QueueResult!
  call(id: ID!):                 CallSnapshot!
  mots(callId: ID!):             [MOT!]!
  callSummary(id: ID!):          CallSummaryResult!
  customer(id: ID!):             Customer!
  customers:                     [Customer!]!
}

# ── Mutation ─────────────────────────────────────────────────────

type Mutation {
  createCall(customerId: ID!):               Call!
  dialCall(customerId: ID!):                 Call!
  approveProduct(callId: ID!, productId: ID!): ApproveResult!
  transferToAgent(callId: ID!):              Call!
  sendLink(callId: ID!, url: String!):       SendLinkResult!
  endCall(callId: ID!):                      Call!
  nextTurn(callId: ID!):                     Turn
  startAudio(callId: ID!):                   Boolean
  audioChunk(callId: ID!, data: String!):    Boolean

  # 내부 _emit* — Streams 팬아웃이 호출, 구독이 @aws_subscribe로 연결.
  _emitTurn(callId: ID!, seq: Int, speaker: String, text: String, flag: TurnFlag): TurnPayload
  _emitIndexUpdate(callId: ID!, churnRisk: Int, emotion: String): IndexUpdatePayload
  _emitSpeechAnalysis(callId: ID!, turnId: ID, polarity: Polarity, reason: String, turnFlag: TurnFlag): SpeechAnalysisPayload
  _emitStrategyUpdate(callId: ID!, strategyHeadline: String!, rationale: String!): StrategyUpdatePayload
  _emitComplianceState(callId: ID!, state: ComplianceStateEnum!, draft: String, finalDiff: String): ComplianceStatePayload
  _emitMot(callId: ID!, markerId: MotMarkerId!, state: MotState!, stage: MotStage!): MotDetectedPayload
  _emitQueueUpdate(callId: ID!, state: CallState): QueueUpdatePayload
  _emitCallEnded(callId: ID!): CallEndedPayload
}

# ── Subscription ─────────────────────────────────────────────────

type Subscription {
  onQueueUpdate: QueueUpdatePayload
    @aws_subscribe(mutations: ["_emitQueueUpdate"])

  onTurn(callId: ID!): TurnPayload
    @aws_subscribe(mutations: ["_emitTurn"])

  onIndexUpdate(callId: ID!): IndexUpdatePayload
    @aws_subscribe(mutations: ["_emitIndexUpdate"])

  onSpeechAnalysis(callId: ID!): SpeechAnalysisPayload
    @aws_subscribe(mutations: ["_emitSpeechAnalysis"])

  onStrategyUpdate(callId: ID!): StrategyUpdatePayload
    @aws_subscribe(mutations: ["_emitStrategyUpdate"])

  onComplianceState(callId: ID!): ComplianceStatePayload
    @aws_subscribe(mutations: ["_emitComplianceState"])

  onMotDetected(callId: ID!): MotDetectedPayload
    @aws_subscribe(mutations: ["_emitMot"])

  onCallEnded(callId: ID!): CallEndedPayload
    @aws_subscribe(mutations: ["_emitCallEnded"])
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
| `flag` | `TurnFlag\|null` | 턴 레벨 플래그 배지 (`RISK \| DEF \| NEUTRAL`). null → NEUTRAL. |
| `tokens` | `[{text,polarity,reason}]` | 분석 토큰 배열 |

> `polarity` ∈ `PRO | CONS | NEUTRAL` — 키워드 **폰트 강조** 전용. 색상 매핑(초록/빨강)은 없습니다.
> risk/def 표시는 턴 레벨 `flag` 배지로 처리됩니다 (`.flag--risk` / `.flag--def`).
> `reason` = 선택된 전략 카드의 리드 텍스트와 연결되는 분류 근거 (한국어).

### 5.4 MOT (Moment of Truth) — SSOT-3 신규 형상

> **[2026-06-22 SSOT-3 정합]** 이전 형상(`type: RISK|CONVERSION`, `churnBefore`, `churnAfter` as MOT fields,
> `triggers`, `strategy`, `outcome`, `narrative`, `MotType` enum)은 폐기되었습니다.
> 신규 형상은 `docs/consult_redesigned-3.html` + `graphql/schema.graphql` 기준.
> MOT는 CRM `.sum-flow` 4단계에 `stage`로 인라인 매핑됩니다 — 별도 MotBoard 컴포넌트 없음.

DynamoDB: PK=`CALL#{id}`, SK=`MOT#{seq:0-pad}`

| 필드 | 타입 | 설명 |
|---|---|---|
| `markerId` | `MotMarkerId` | `MOT_1 \| MOT_2 \| MOT_3 \| MOT_4 \| MOT_5` |
| `state` | `MotState` | `SHOW \| ALERT \| BLOCKED` |
| `stage` | `MotStage` | `TRUST \| OBJECTION \| COLLATERAL \| CLOSE` (CRM sum-flow 4단계 매핑) |
| `turnSeq` | int | 해당 발화 시퀀스 |

> `markerId` enum 값(`MOT_1`~`MOT_5`)은 wire 필드입니다. rz-rate/compare/pay/security/avoid 이름은 FRONTEND DOM 매핑 전용 — wire에 전송되지 않습니다.
> `stage` → CRM sum-flow 매핑: `TRUST`=신뢰쌓기, `OBJECTION`=우려풀기, `COLLATERAL`=담보오해, `CLOSE`=전환맺기.

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

### 5.8 Analysis (call 스냅샷 분석)

`CallSnapshot.analysis` 필드 형상. SSOT-3 기준 4필드만 사용.

> 폐기 필드: `aiAction`, `data(live/static)`, `AnalysisData` — 사용하지 마십시오.

| 필드 | 타입 | 설명 |
|---|---|---|
| `strategyHeadline` | string | 전략 한 줄 요약 (카드① `.stx`) |
| `rationale` | string | 전략 근거 (카드① `.slead`) |
| `churnRisk` | float | 이탈위험도 0-100 |
| `emotion` | string | 감정 레이블 (한국어, 예: `"불안"`, `"관심"`) |

---

## 6. 오퍼레이션 ↔ 화면 ↔ 모듈 매핑 / Operation Map

> FRONTEND 소유(화면) / BACKEND 소유(GraphQL 스키마) / AGENT 생산(분석 이벤트 값) / DATA 소유(DynamoDB 모델)

| 화면 | Query (초기 로드) | Mutation (액션) | Subscription (실시간) | 화면 owner | 데이터 provider |
|---|---|---|---|---|---|
| **관리자 대시보드** | `queue` | — | `onQueueUpdate` | FRONTEND | BACKEND |
| **사전 고객분석** (세그먼트) | `customer`, `customers` | `createCall` (분석), `dialCall` (통화 버튼) | — | FRONTEND | BACKEND |
| **실시간 상담 모니터링** | `call`, `products`, `mots` | `approveProduct`, `transferToAgent`, `sendLink`, `endCall` | `onTurn`, `onIndexUpdate`, `onSpeechAnalysis`, `onStrategyUpdate`, `onComplianceState`, `onMotDetected`, `onCallEnded` | FRONTEND | BACKEND + AGENT |
| **통화 종료·인계 요약** (CRM + MOT sum-flow 인라인) | `callSummary` | — | (`onCallEnded` → 화면 전환 트리거) | FRONTEND | BACKEND + AGENT |

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
