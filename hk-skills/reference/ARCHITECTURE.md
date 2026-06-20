# ARCHITECTURE — 시스템 아키텍처 / System Architecture

> **모든 skill은 이 아키텍처를 따릅니다. 우회 금지.**
> **All skills must follow this architecture. No detours.**
>
> **아키텍처 SSOT**: `docs/nextjs-aws-architecture.md` + `docs/architecture-diagram.svg`
> 본 문서는 그 SSOT를 skill/구현 가이드 수준으로 구체화한 것이다. 충돌 시 SSOT가 우선.

---

## 1. 컴포넌트 다이어그램 / Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  브라우저                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  관리자/상담원 UI                                                          │    │
│  │  관리자 화면 · 세그먼트 분석 · AI 상담화면 · 상담 CRM                        │    │
│  └──────────────────────────────┬──────────────────────────────────────────┘    │
└─────────────────────────────────┼───────────────────────────────────────────────┘
                                  │ HTTPS / WSS (GraphQL)
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  엣지 · 호스팅                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  CloudFront — CDN / TLS                                                  │    │
│  └──────────────────────────────┬──────────────────────────────────────────┘    │
│                                 │                                                │
│  ┌──────────────────────────────▼──────────────────────────────────────────┐    │
│  │  Amplify Hosting · Next.js 15  (App Router · SSR / ISR)                  │    │
│  │  git push → 자동 CI/CD 빌드·배포                                           │    │
│  └──────┬──────────────────────────────────────────────────────────┬───────┘    │
└─────────┼────────────────────────────────────────────────────────── ┼────────────┘
          │ GraphQL                                                    │ 정적 시나리오 로드
          ▼                                                            ▼
┌─────────────────────────────────┐          ┌──────────────────────────────────┐
│  실시간 · API                    │          │  데이터 · 스토리지               │
│  ┌──────────────────────────┐   │          │  ┌──────────────────────────┐   │
│  │  AppSync (GraphQL)        │   │          │  │  DynamoDB + Streams       │   │
│  │  구독 푸시 · 뮤테이션       │   │          │  │  call · turn · MOT        │   │
│  │  createCall · dialCall    │   │          │  │  compliance              │   │
│  │  nextTurn · endCall       │   │          │  └──────────────────────────┘   │
│  └──────┬──────────┬─────────┘   │          │  ┌──────────────────────────┐   │
│         │Resolver  │Lambda       │          │  │  S3                      │   │
│         │직결      │데이터소스    │          │  │  scenario.json           │   │
│  ┌──────▼──┐  ┌────▼────────┐   │          │  │  렉시콘 · mp3            │   │
│  │DynamoDB │  │  Lambda     │   │          │  └──────────────────────────┘   │
│  │(read/   │  │orchestrator │   │          │                                  │
│  │ write)  │  │             │   │          │  DynamoDB Streams → 팬아웃       │
│  └─────────┘  │  ┌────────┐ │   │          │  → AppSync 구독 push            │
│               │  │SCRIPT  │ │   │          └──────────────────────────────────┘
│               │  │MODE    │ │   │
│               │  │(기본)  │ │   │          ┌──────────────────────────────────┐
│               │  └────────┘ │   │          │  AI · 음성 (라이브 모드)          │
│               │  ┌────────┐ │   │          │  ┌────────────────────────────┐  │
│               │  │LIVE    │ │   │          │  │  Bedrock Converse (LLM)    │  │
│               │  │MODE    │ │   │          │  │  Bedrock Guardrails        │  │
│               │  │(옵션)  │─┼───┼──────────▶  │  Transcribe (STT)          │  │
│               │  └────────┘ │   │          │  │  Typecast (TTS)            │  │
│               └─────────────┘   │          │  │  ssfm-v30 · 혜라/진서/유라  │  │
└─────────────────────────────────┘          │  │  (외부 REST · X-API-KEY)   │  │
                                             │  └────────────────────────────┘  │
                                             └──────────────────────────────────┘

공통(경량): IAM · CloudWatch
운영 헤비 자원(Fargate/Aurora/Cognito/VPC/Step Functions)은 부스 데모 범위 외.
```

### 1.1 두 가지 실행 모드 / Two Execution Modes

| 모드 | 트리거 | 동작 | 언제 사용 |
|------|--------|------|-----------|
| **스크립트 모드** (기본) | Lambda가 `scenario.json` 읽기 | S3의 사전 작성 시나리오를 순서대로 emit — 항상 동일 재생 | 부스 발표, 리허설, 네트워크 불안정 시 |
| **라이브 모드** (옵션) | 토글 한 번 | Bedrock Converse + Guardrails + Transcribe STT + Typecast TTS 실제 호출 | "AWS AI 실연" 하이라이트 구간 |

> 두 모드가 **동일한 AppSync 이벤트 계약**을 사용하므로 프론트엔드는 모드를 알 필요 없다. 부스 안정성과 실제 AI 시연을 동시에 만족.

---

## 2. 데이터 흐름 (통화 1건) / Data Flow (One Call)

```
1. 관리자가 행 클릭 → 세그먼트 분석 화면 진입 (행 클릭만으로 자동 발신 없음)
   분석 완료 후 "통화" 버튼 클릭
   └─→ dialCall 뮤테이션 (AppSync mutation)
       └─→ Lambda orchestrator: DynamoDB에 Call 아이템 생성 (state = DIALING)
           └─→ AppSync subscriptions → 브라우저에 상태 push

2. 스크립트 모드 턴 루프:
   nextTurn 뮤테이션 호출
   └─→ Lambda가 S3의 scenario.json에서 다음 발화 읽기
       └─→ DynamoDB에 Turn 아이템 write (speaker, text, tokens, churn_after, node)
           └─→ DynamoDB Streams → AppSync 팬아웃 → onTurn 구독 → 브라우저 수신

   (라이브 모드 시):
   노트북 마이크 → lib/mic.ts → audio chunk
   └─→ Lambda STT (Transcribe, ko-KR) → transcript text
       └─→ LangGraph agent (Bedrock Converse) → 응답 text
           └─→ ComplianceReview 루프 (Bedrock Guardrails)
               └─→ Typecast TTS → mp3 → S3 → 브라우저 재생
               └─→ DynamoDB에 Turn + ComplianceReview 아이템 write
                   └─→ DynamoDB Streams → AppSync 팬아웃

3. 매 고객 턴 후: MOT 탐지 (Lambda agent/mot.py)
   - RISK MOT: churnAfter - churnBefore ≥ +12 또는 churnAfter ≥ 60
   - CONVERSION MOT: TRANSFER_INTENT / BUYING_INTENT 매칭
   └─→ DynamoDB에 MOT 아이템 write
       └─→ Streams → onMotDetected 구독 → JourneyMap 마커 + MotFloating

4. classify 노드: 한도조회 / 상담원 연결 의도 감지
   └─→ transfer 뮤테이션 → state = TRANSFER_PENDING
       └─→ AppSync → 관리자 큐 강조

   금융사기 의심 감지 (병렬, 종료 아님):
   └─→ call.fraud_suspected = true (DynamoDB write)
       └─→ Streams → onIndexUpdate → 대시보드 강조 카드 반영
           통화는 계속 연결 (분기/종료 없음)

5. endCall 뮤테이션 → state = ENDED
   └─→ Lambda가 turn/MOT 읽어 Summary 아이템 생성 (DynamoDB)
       └─→ Streams → onCallEnded 구독 → CRM 화면(crm/[id]) 전환
```

---

## 3. 상태 머신 / State Machine

### 3.1 Call 상태 / Call States

```
DIALING → RINGING → ACCEPTED → IN_CALL → TRANSFER_PENDING → AGENT_JOINED → ENDED
                       │                                                       ▲
                   (REJECTED) ─────────────────────────────────────────────── ┘
```

| 상태 | 의미 |
|------|------|
| `DIALING` | "통화" 버튼으로 dialCall 뮤테이션 발신 (자동 발신 아님) |
| `RINGING` | 발신음 (Lambda orchestrator 초기화 중) |
| `ACCEPTED` | 통화 시작 / STT 스트림 활성화 |
| `REJECTED` | 미연결 → ENDED |
| `IN_CALL` | AI 콜봇 대화 중 (스크립트 or 라이브 모드) |
| `TRANSFER_PENDING` | classify가 transfer intent 감지 → 상담원 연결 대기 |
| `AGENT_JOINED` | 상담원이 행 클릭 → /calls/[id] 진입 |
| `ENDED` | 통화 종료, AI Summary 생성 완료 |

### 3.2 시나리오 / Scenario

시나리오는 **S1 단일 고정**. S2/S3/"분노" 시나리오는 존재하지 않는다.

**S1 (상품 관심 → 한도조회 → 상담원 연결)**:
```
GREETING → INTRO_PRODUCT → HANDLE_OBJECTION → OFFER_SIGNUP
  → [한도조회 요청 / 상담원 연결 요청] → TRANSFER_TO_AGENT → TRANSFER_PENDING
  → [거절]                             → CLOSING → ENDED
```

**금융사기 의심 (라우팅 분기 아님 / not a routing branch)**:
- Lambda agent의 `agent/nodes.py` classify 로직이 매 턴 의심 발화를 판단하는 **플래그 처리**.
- 의심 시 `call.fraud_suspected = true` + DynamoDB write → Streams → `onIndexUpdate` → 대시보드 강조.
- **통화는 종료하지 않고 S1 그래프를 그대로 계속 진행** (별도 시나리오/종료 분기 없음).

**LangGraph (라이브 모드)**:
- 그래프 조립: `lambda/orchestrator/agent/graph.py` (`build_graph`)
- 노드 함수: `lambda/orchestrator/agent/nodes.py` (LLM 호출 + 결과 write)
- 상태 타입: `lambda/orchestrator/agent/state.py`
- classify/transfer/detect_fraud 로직: `lambda/orchestrator/agent/nodes.py`
- 이탈위험도 계산: `lambda/orchestrator/agent/churn_risk.py`
- MOT 탐지: `lambda/orchestrator/agent/mot.py`
- 컴플라이언스 루프: `lambda/orchestrator/agent/compliance.py`

### 3.3 컴플라이언스 루프 / Compliance Loop (라이브 모드)

스크립트 모드에서는 `scenario.json`에 사전 기록된 단계 타임라인을 재생.
라이브 모드에서는 아래 루프를 Lambda 내에서 실행:

```
draft = Bedrock.converse(prompt)              → onComplianceState: drafting
v = Guardrails.apply(draft)                   → reviewing
while v.blocked and try < 2:
    log ComplianceReview(violation, draft)    → redacting (텍스트 삭제 연출)
    draft = Bedrock.converse(prompt + 회피지시) → redrafting
    v = Guardrails.apply(draft)
emit approved → Typecast TTS
```

각 단계 전이는 DynamoDB ComplianceReview 아이템 write → Streams → `onComplianceState` 구독 → `CompliancePanel.tsx` 상태 전환 (drafting → reviewing → redacting → redrafting → approved).

---

## 4. 데이터 모델 — DynamoDB 싱글 테이블 (+Streams) / Data Model

> SQL DDL 없음. DynamoDB 싱글 테이블 + Streams. 모든 엔터티가 동일 테이블에 공존.
> 키 설계 · 마샬링 SSOT: DATA 모듈 (`lambda/orchestrator/models/`).

| 엔터티 | PK | SK | 핵심 속성 |
|--------|----|----|-----------|
| **Call** | `CALL#{id}` | `META` | `state, customer_id, started_at, ended_at, fraud_suspected` |
| **Turn** | `CALL#{id}` | `TURN#{seq}` | `speaker, text, tokens[{text, polarity, reason}], churn_after, node` |
| **MOT** | `CALL#{id}` | `MOT#{seq}` | `type(RISK\|CONVERSION), turnSeq, churnBefore, churnAfter, triggers[], strategy{tactic, headline}, outcome(defended\|converted\|lost), narrative` |
| **ComplianceReview** | `CALL#{id}` | `CMPL#{turn}#{try}` | `draft, verdict, violatedPolicies[], action(approved\|rewritten)` |
| **Summary** | `CALL#{id}` | `SUMMARY` | `result_type, content, flow[], categories[], created_at` |
| **Product** | `PRODUCT#{id}` | `META` | `name, description, monthly_fee` |
| **Customer** | `CUSTOMER#{id}` | `META` | `name, phone, target_product, rate, limit, existing_loans, has_vehicle, credit_score, persona_json, scenario_hint` |

**DynamoDB Streams 팬아웃**: 아이템 write 이벤트 → AppSync 구독으로 브라우저에 push.

| 구독 이벤트 | 트리거 아이템 | 화면 수신 |
|------------|--------------|----------|
| `onTurn` | Turn write | SpeechAnalysis 카드 (polarity/reason 토큰) |
| `onIndexUpdate` | Turn.churn_after write | 이탈위험도 게이지, fraud_suspected 플래그 |
| `onSpeechAnalysis` | Turn.tokens write | SpeechAnalysis 키워드 초록/빨강 + 사유 아코디언 |
| `onStrategyUpdate` | Turn.node write (전략) | StrategyPanel (headline 큰 텍스트 + Data 칩) |
| `onComplianceState` | ComplianceReview write | CompliancePanel 단계 전환 |
| `onMotDetected` | MOT write | JourneyMap 마커 + MotFloating + CRM MotBoard |
| `onCallEnded` | Call.state=ENDED | CRM 화면 전환 |

---

## 5. 디렉토리 ↔ 아키텍처 매핑 / Directory ↔ Architecture

| 컴포넌트 | 경로 | 모듈 owner |
|----------|------|------------|
| LangGraph 그래프 조립 | `lambda/orchestrator/agent/graph.py` | AGENT (은경) |
| LangGraph 노드 함수 | `lambda/orchestrator/agent/nodes.py` | AGENT |
| LangGraph 상태 타입 | `lambda/orchestrator/agent/state.py` | AGENT |
| 상태 재구성 (DynamoDB→CallState) | `lambda/orchestrator/agent/context.py` | AGENT |
| stage별 시스템 프롬프트 (xlsx 시나리오) | `lambda/orchestrator/agent/prompts.py` | AGENT |
| 이탈위험도 계산 | `lambda/orchestrator/agent/churn_risk.py` | AGENT |
| MOT 탐지 | `lambda/orchestrator/agent/mot.py` | AGENT |
| 컴플라이언스 루프 | `lambda/orchestrator/agent/compliance.py` | AGENT |
| LLM 라우터 (Bedrock Converse) | `lambda/orchestrator/llm/router.py` | AGENT |
| STT 브리지 (Transcribe) | `lambda/orchestrator/stt/transcribe_stt.py` | AGENT |
| TTS 브리지 (Typecast) | `lambda/orchestrator/tts/typecast_tts.py` | AGENT |
| Lambda 핸들러 엔트리 | `lambda/orchestrator/handler.py` | BACKEND (지원) |
| AppSync GraphQL 스키마 | `graphql/schema.graphql` | BACKEND |
| Lambda resolver 글루 | `lambda/orchestrator/resolvers/*` | BACKEND |
| DynamoDB 엔터티 모델 | `lambda/orchestrator/models/*` | DATA (수민) |
| 시드 스크립트 | `lambda/orchestrator/seed.py` | DATA |
| 시나리오 JSON (S3 배포본) | `data/scenarios/s1.json` | DATA |
| 이탈위험 렉시콘 (S3 배포본) | `data/lexicon/churn_risk_lexicon.json` | DATA |
| 발화분석 카드 (PRO/CONS + 아코디언) | `frontend/src/components/consult/SpeechAnalysis.tsx` | FRONTEND (주실) |
| 전략 패널 (headline + Data 칩) | `frontend/src/components/consult/StrategyPanel.tsx` | FRONTEND |
| 컴플라이언스 패널 | `frontend/src/components/consult/CompliancePanel.tsx` | FRONTEND |
| 여정 맵 + MOT 마커 | `frontend/src/components/consult/JourneyMap.tsx` | FRONTEND |
| MOT 플로팅 카드 | `frontend/src/components/consult/MotFloating.tsx` | FRONTEND |
| CRM MOT 보드 | `frontend/src/components/crm/MotBoard.tsx` | FRONTEND |
| AppSync GraphQL 클라이언트 | `frontend/src/lib/appsync.ts` | FRONTEND |
| 마이크 캡처 (라이브 모드) | `frontend/src/lib/mic.ts` | FRONTEND |
| AWS IaC (CDK TypeScript) | `infra/` | CLOUD (일조) |
| Amplify CI/CD 설정 | `amplify.yml` | CLOUD |

> **우회 금지**: 새 파일을 만들 때 위 경로를 우선 사용. 경계 변경은 `docs/MODULES.md` PR.

---

## 6. 보안 / Security (데모 한정 / Demo-only)

| 항목 | 설정 |
|------|------|
| 인증 | 없음 (Amplify 기본 보호, 단일 부스 무인증 데모) |
| TLS/HTTPS | CloudFront가 자동 제공 (HTTP 없음) |
| WebSocket | WSS (GraphQL subscriptions over HTTPS) |
| 시크릿 관리 | Secrets Manager (`TYPECAST_API_KEY`) — `.env` git 비포함 |
| IAM | Lambda·AppSync·DynamoDB·S3·Bedrock 최소 권한 (least-privilege) |
| 입력 검증 | AppSync 스키마 타입 + Lambda 내부 Pydantic-style 검증 |
| 운영 모니터링 | CloudWatch Logs/Metrics (Lambda, AppSync) |

---

## 7. 배포 / Deployment

스크립트 모드가 부스 데모를 결정론적으로 만들기 때문에 `cdk deploy` 한 번이면 발표 준비 완료.

### 7.1 인프라 (CDK)

```bash
cd infra
npm install
cdk bootstrap   # 계정 최초 1회
cdk deploy      # Amplify · AppSync · DynamoDB · Lambda · S3 · IAM 일괄 프로비저닝
```

CDK 스택 (`infra/`)은 CLOUD(일조) 소유. 변경은 `infra/cdk.json` PR.

### 7.2 프론트엔드 (Amplify)

```bash
git push origin main   # → Amplify 자동 빌드 · CloudFront 배포
```

`amplify.yml`에 Next.js 15 SSR 빌드 설정. 환경변수 (`NEXT_PUBLIC_APPSYNC_URL` 등)는 Amplify Console에서 관리.

### 7.3 데이터 (S3 + DynamoDB 시드)

```bash
# 시나리오 · 렉시콘 S3 업로드 (DATA 모듈)
aws s3 cp data/scenarios/s1.json s3://<bucket>/scenarios/s1.json
aws s3 cp data/lexicon/churn_risk_lexicon.json s3://<bucket>/lexicon/churn_risk_lexicon.json

# DynamoDB 시드 (Customer · Product 초기 데이터)
cd lambda/orchestrator && python seed.py
```

### 7.4 배포 순서 / Deploy Order

```
1. cdk deploy        (CLOUD)   → AppSync URL · DynamoDB ARN · Lambda ARN 출력
2. Amplify env 설정  (CLOUD)   → NEXT_PUBLIC_APPSYNC_URL 등록
3. git push main     (CLOUD)   → Amplify 빌드 자동 시작
4. s3 cp + seed.py   (DATA)    → 시나리오·렉시콘·시드 데이터 투입
5. 스모크 테스트      (전체)    → 스크립트 모드 1회 재생 확인
```
