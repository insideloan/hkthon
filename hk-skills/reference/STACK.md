# STACK — 기술 스택 / Tech Stack

> **모든 skill은 이 문서를 SSOT로 참조합니다. 변경 시 모든 skill을 재검토하세요.**
> **All skills treat this document as the SSOT. Review all skills when changing it.**
>
> **아키텍처 SSOT**: `docs/nextjs-aws-architecture.md` + `docs/architecture-diagram.svg`
> (Amplify + AppSync + Lambda + DynamoDB + S3 라이트 서버리스). FastAPI/DuckDB/WebSocket은 폐기.

---

## 1. Language & Runtime

| 영역 | 선택 | 버전 | 비고 |
|---|---|---|---|
| Orchestrator (Lambda) | Python | 3.13+ | AWS Lambda 런타임 |
| Frontend | TypeScript | 5.4+ | Next.js 15 + React 19 |
| Frontend styling | Tailwind CSS | 3.4+ | config 기반 theme |
| IaC | TypeScript (CDK) | AWS CDK v2 | `infra/` 디렉토리 |
| Package manager (FE) | pnpm | 9+ | npm/yarn 금지 |
| Package manager (BE) | pip / requirements.txt | — | `lambda/orchestrator/requirements.txt` |

---

## 2. Frontend (Next.js 15 / Amplify Hosting)

### 핵심 의존성 / Core deps

```json
{
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwindcss": "^3.4.0",
    "aws-amplify": "^6.0.0",           // AppSync GraphQL 클라이언트
    "@xyflow/react": "^12.3.0",        // 여정 그래프 (JourneyMap)
    "zustand": "^5.0.0",               // 클라이언트 상태
    "zod": "^3.23.0",                  // 타입/검증
    "lucide-react": "^0.460.0",        // 아이콘
    "clsx": "^2.1.1"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0"
  }
}
```

> 프론트엔드는 **AppSync(GraphQL)만** 통신한다. REST 엔드포인트 없음, 자체 WebSocket 없음.

### 디렉토리 구조 / Directory layout

```
frontend/
├── package.json
├── pnpm-lock.yaml
├── tailwind.config.ts               # theme/colors SSOT (TEAM-LOCK)
├── next.config.mjs                  # CLOUD 소유 (TEAM-LOCK)
├── amplify.yml                      # Amplify 빌드 설정 (CLOUD 소유)
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx                  # / → 관리자 화면 (콜 큐 + 요약카드)
    │   ├── segment/[customerId]/page.tsx  # 사전 고객분석 + 통화 버튼
    │   ├── calls/[id]/page.tsx       # AI 상담화면
    │   └── crm/[id]/page.tsx         # 상담 CRM (+MOT 영역)
    ├── components/
    │   ├── ui/                       # wrapper (공유, 누구든 push)
    │   │   ├── Button.tsx
    │   │   ├── Card.tsx
    │   │   ├── Table.tsx
    │   │   └── ...
    │   ├── consult/
    │   │   ├── SpeechAnalysis.tsx    # 카드① 발화분석: PRO=초록/CONS=빨강 + 사유 아코디언
    │   │   ├── StrategyPanel.tsx     # 카드② "상담 전략" headline + Data 칩
    │   │   ├── CompliancePanel.tsx   # 작성→리뷰→삭제→재작성 상태머신
    │   │   ├── JourneyMap.tsx        # 여정 + MOT 마커 (@xyflow/react)
    │   │   └── MotFloating.tsx       # MOT 클릭 플로팅 카드
    │   ├── queue/
    │   │   └── OutboundQueueTable.tsx
    │   └── crm/
    │       └── MotBoard.tsx          # MOT 타임라인 + 디테일 보드
    ├── lib/
    │   ├── appsync.ts                # AppSync 클라이언트 (aws-amplify)
    │   └── mic.ts                    # 마이크 입력 + Web Audio 재생
    ├── stores/                       # Zustand stores
    │   ├── callStore.ts
    │   ├── queueStore.ts
    │   └── motStore.ts
    └── types/                        # AppSync 계약 타입 (DATA/BACKEND와 합의)
        ├── call.ts
        ├── customer.ts
        ├── transcript.ts
        ├── mot.ts
        └── summary.ts
```

### 호스팅 / Hosting

**AWS Amplify Hosting** — Next.js 15 SSR/ISR 네이티브 지원, git push → 자동 CI/CD, CloudFront CDN/TLS 자동 구성. 추가 설정 없이 서버리스 배포 완성.

### Tailwind Theme

- `tailwind.config.ts`의 `theme.extend`만 수정해서 전체 색상/폰트/간격 변경
- 컴포넌트에서 Tailwind 클래스 직접 사용 금지 → 모두 `src/components/ui/*` wrapper를 통해서
- 새 template을 들여올 때: (1) `tailwind.config.ts` theme 교체, (2) `src/components/ui/*` 내용물만 교체

---

## 3. 실시간 API — AWS AppSync (GraphQL)

프론트엔드와 오케스트레이터 Lambda 사이의 **유일한 통신 채널**. 구독(WebSocket-over-GraphQL) + 뮤테이션.

### GraphQL 스키마 위치

```
graphql/
└── schema.graphql     # BACKEND(지원)가 정의·소유. 변경은 BACKEND PR.
```

### 뮤테이션 / Mutations

| 뮤테이션 | 설명 |
|---|---|
| `createCall` | 분석 전용 콜 생성 |
| `dialCall` | 통화 버튼 → `DIALING` 전환 |
| `nextTurn` | 스크립트 모드 다음 턴 진행 |
| `endCall` | 통화 종료 + 요약 트리거 |

### 구독 / Subscriptions (모두 `callId` 인자)

| 구독 | 페이로드 |
|---|---|
| `onQueueUpdate` | 콜 큐 상태 변경 |
| `onTurn` | 발화 턴 (speaker, text, tokens) |
| `onIndexUpdate` | 이탈위험도 + 감정 점수 |
| `onSpeechAnalysis` | 토큰 polarity / reason |
| `onStrategyUpdate` | 상담 전략 headline |
| `onComplianceState` | `drafting`→`reviewing`→`redacting`→`redrafting`→`approved` |
| `onMotDetected` | MOT(Moment of Truth) 감지 |
| `onCallEnded` | 통화 종료 이벤트 |

> 스크립트 모드·라이브 모드가 **동일 AppSync 계약**을 공유. 프론트엔드는 모드를 알 필요가 없다.

---

## 4. 오케스트레이터 — AWS Lambda (Python 3.13)

AppSync Lambda 데이터소스로 연결. 두 가지 실행 모드가 **동일 핸들러**에 공존.

### 핵심 의존성 / Core deps (`lambda/orchestrator/requirements.txt`)

```
boto3>=1.35
pydantic>=2.9
langchain>=0.3
langgraph>=0.2
langchain-aws>=0.2        # ChatBedrockConverse (Bedrock Converse API)
amazon-transcribe>=0.6    # STT streaming (라이브 모드)
httpx>=0.27               # Typecast TTS REST 호출
```

### 디렉토리 구조 / Directory layout

```
lambda/orchestrator/
├── handler.py              # Lambda 엔트리포인트 (AppSync 이벤트 라우팅)
├── requirements.txt        # Python 의존성 (TEAM-LOCK)
├── api/                    # AppSync 이벤트 파싱·응답 글루 (BACKEND 소유)
├── resolvers/              # 뮤테이션/구독 resolver 구현 (BACKEND 소유)
├── agent/                  # 비즈니스 로직: churn_risk·MOT·classify·컴플라이언스 (AGENT 소유)
│   └── churn_risk.py       # 이탈위험도 계산 (렉시콘 기반)
├── llm/                    # LLM 브리지: ChatBedrockConverse (AGENT 소유)
├── stt/                    # STT 브리지: AWS Transcribe (AGENT 소유)
├── tts/                    # TTS 브리지: Typecast REST (AGENT 소유)
│   └── typecast_tts.py
├── models/                 # DynamoDB 엔터티 모델·마샬링 (DATA 소유)
├── seed.py                 # DynamoDB 초기 데이터 적재 (DATA 소유)
└── tests/                  # 공유 (모든 모듈 자유 기여)
```

### 두 가지 실행 모드

| 모드 | 기본값 | 동작 |
|---|---|---|
| **스크립트 모드** | ✅ 기본·발표용 | S3의 `scenario.json`에서 다음 턴을 읽어 AppSync로 emit. AI/네트워크 장애와 무관하게 동일 재생 |
| **라이브 모드** | 선택(토글) | Bedrock(LLM)·Transcribe(STT)·Typecast(TTS) 실제 호출. 동일 AppSync 계약 사용 |

### 환경변수 / Env vars

```bash
# LLM (Bedrock 전용)
LLM_MODEL=global.anthropic.claude-sonnet-4-6
AWS_REGION=ap-northeast-2

# STT (AWS Transcribe, 라이브 모드)
TRANSCRIBE_LANGUAGE=ko-KR

# TTS (Typecast, 라이브 모드)
TYPECAST_API_KEY=tc_...        # https://typecast.ai 발급 (X-API-KEY 헤더)
TYPECAST_MODEL=ssfm-v30        # ssfm-v30(권장)
TYPECAST_VOICE=혜라            # 혜라 | 진서 | 유라

# S3
SCENARIO_BUCKET=<버킷명>
SCENARIO_KEY=scenarios/scenario.json
LEXICON_KEY=lexicon/churn_risk_lexicon.json

# 실행 모드
ORCHESTRATOR_MODE=script       # script | live

LOG_LEVEL=INFO
```

---

## 5. AI · 음성 (라이브 모드) / AI · Voice (Live Mode)

### LLM — AWS Bedrock Converse

- **Model**: `global.anthropic.claude-sonnet-4-6`
- **SDK**: `langchain-aws` (`ChatBedrockConverse`). **Bedrock 전용** (다른 LLM provider 없음)
- **컴플라이언스 루프**: Bedrock Guardrails로 draft 검수 → 위반 시 최대 2회 재작성 후 `approved` emit

```
draft = Bedrock.converse(prompt)           # onComplianceState: drafting
v = Guardrails.apply(draft)               # reviewing
while v.blocked and try < 2:
  log ComplianceReview(violation, draft)  # redacting (텍스트 삭제 연출)
  draft = Bedrock.converse(prompt + 회피지시)  # redrafting
  v = Guardrails.apply(draft)
emit approved → Typecast(TTS)
```

> 스크립트 모드에서는 위 단계 타임라인을 `scenario.json`에 미리 기록해 동일 연출로 재생.

### STT — AWS Transcribe

- **Protocol**: streaming (amazon-transcribe async SDK, HTTP/2)
- **입력**: chunked audio (노트북 마이크)
- **언어**: 한국어 (`LanguageCode=ko-KR`)
- **출력**: `{text, isFinal}` → DynamoDB `Turn` 아이템 기록

### TTS — Typecast

- **Protocol**: REST (httpx) — `POST https://api.typecast.ai/v1/text-to-speech`, 헤더 `X-API-KEY: <TYPECAST_API_KEY>`
- **Model**: `ssfm-v30`
- **Voice**: `혜라` / `진서` / `유라` 중 선택 (한국어 여성, 데모용 화자)
- **이름 → voice_id 매핑** (`typecast_tts.py` 고정값):

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
- **출력**: 바이너리 MP3 → S3 저장 후 프론트 재생 (노트북 스피커). Typecast는 **AWS 외부** 서비스 (`X-API-KEY` REST).

---

## 6. 데이터 / Data

### DynamoDB 싱글 테이블 (+Streams)

| 엔터티 | PK / SK | 핵심 필드 |
|---|---|---|
| `Call` | `CALL#{id}` / `META` | `state, customer_id, started_at, ended_at` |
| `Turn` | `CALL#{id}` / `TURN#{seq}` | `speaker, text, tokens[{text,polarity,reason}], churn_after, node` |
| **`MOT`** | `CALL#{id}` / `MOT#{seq}` | `type(RISK\|CONVERSION), turnSeq, churnBefore, churnAfter, triggers[], strategy{tactic,headline}, outcome(defended\|converted\|lost), narrative` |
| **`ComplianceReview`** | `CALL#{id}` / `CMPL#{turn}#{try}` | `draft, verdict, violatedPolicies[], action(approved\|rewritten)` |
| `Summary` | `CALL#{id}` / `SUMMARY` | 통화 종료 요약 (Lambda 단일 처리) |

- DynamoDB Streams → AppSync 팬아웃(구독 push)
- 접근 패턴: **boto3 + 싱글 테이블 패턴**만 사용. 직접 SQL/관계형 DB 금지.
- 모델·마샬링 SSOT: `lambda/orchestrator/models/` (DATA 소유)

### S3

| 오브젝트 | 용도 |
|---|---|
| `scenarios/scenario.json` | 스크립트 모드 시나리오 (HTML `S[]/PICK[]/REASON[]/EMO9/DB9` 직렬화) |
| `lexicon/churn_risk_lexicon.json` | 이탈위험도 키워드 사전 (S3 배포본; SSOT는 `docs/reference/`) |
| `audio/*.mp3` | Typecast TTS 출력물 |

> **시나리오 데이터 소유**: DATA 모듈 (`data/scenarios/*`, `data/lexicon/*`). 렉시콘 점수모델 SSOT는 `docs/reference/CHURN-RISK-LEXICON.md` + `docs/reference/churn_risk_lexicon.json` (TEAM-LOCK).

---

## 7. 인프라 — AWS CDK (IaC)

```
infra/
├── cdk.json                  # CDK 앱 설정 (TEAM-LOCK)
└── package.json              # CDK 의존성 (TEAM-LOCK)
```

CLOUD 모듈(일조)이 소유. CDK TypeScript로 다음 리소스를 프로비저닝:

| 리소스 | 역할 |
|---|---|
| **Amplify Hosting** | Next.js 15 SSR + git CI/CD + CloudFront 자동 |
| **AppSync** | GraphQL API (구독/뮤테이션). Lambda 데이터소스 + DynamoDB resolver 직결 |
| **DynamoDB** | 싱글 테이블 + Streams 활성화 |
| **Lambda** | `orchestrator` 함수 (Python 3.13). AppSync 데이터소스로 연결 |
| **S3** | 시나리오·렉시콘·mp3 저장 버킷 |
| **IAM** | Lambda → Bedrock/Transcribe/DynamoDB/S3 최소권한 롤 |
| **CloudWatch** | Lambda 로그·알람 (경량) |

> **배제**: ECS Fargate, Aurora, Step Functions, Cognito, VPC, WAF, EventBridge 버스 — 부스 데모 범위 외. 이유: 상주 서버 불필요(스크립트 모드), 관계형 영속 불필요, 단일 부스·무인증 데모.

---

## 8. 개발 도구 / Dev Tools

| 용도 | 도구 |
|---|---|
| Frontend dev | `pnpm dev` (port 3000) |
| Frontend type check | `tsc --noEmit` |
| Frontend lint | `next lint` |
| Lambda 로컬 테스트 | `python -m pytest lambda/orchestrator/tests/` |
| Lambda lint | `ruff check lambda/` |
| IaC synth/deploy | `cdk synth` / `cdk deploy` |
| DynamoDB 시드 | `python lambda/orchestrator/seed.py` (boto3로 DynamoDB에 직접 적재) |

> `uvicorn`, `python -m app.seed` (DuckDB 대상), FastAPI 관련 명령은 폐기.

---

## 9. 신규 도메인 개념 / New Domain Concepts

| 개념 | 정의 |
|---|---|
| **MOT (Moment of Truth)** | 이탈위험도 급등(`churnAfter - churnBefore ≥ +12` 또는 `churnAfter ≥ 60`) 또는 전환 의도 매칭 턴. 여정 마커·플로팅·CRM 보드가 동일 레코드 공유 |
| **ComplianceReview** | Bedrock Guardrails 검수 사이클의 단일 시도 기록 (`draft→verdict→action`) |

---

## 10. 금지 / Forbidden

- ❌ **새 의존성 추가 금지** — 정말 필요하면 팀 합의 + PR + 이 문서 업데이트.
- ❌ **DynamoDB 접근은 boto3/싱글 테이블 패턴만** — 직접 SQL, 관계형 DB(DuckDB/SQLModel/RDS 등) 금지.
- ❌ **Inline `style={{...}}` 금지** — Tailwind 클래스는 반드시 `src/components/ui/*` wrapper 경유.
- ❌ **새 LLM provider 추가 금지** — AWS Bedrock 전용 (`ChatBedrockConverse`, langchain-aws).
- ❌ **새 STT/TTS provider 추가 금지** — STT는 AWS Transcribe, TTS는 Typecast만. TTS voice는 `혜라`/`진서`/`유라` 중에서만.
- ❌ **`any` 타입 사용 금지** — TypeScript에서 `any` 금지. `unknown` + 타입가드 사용.
- ❌ **인증/인가 추가 금지** — 데모는 open (Amplify 기본 보호로 충분).
- ❌ **FastAPI / uvicorn / WebSocket 서버 / DuckDB** 재도입 금지 — 구 아키텍처 폐기.

위반 발견 시 → `hk-iterate` skill로 가드레일 재확인.
