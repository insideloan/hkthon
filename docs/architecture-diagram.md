# AI 상담 코파일럿 — AWS 아키텍처 (부스 데모 · 라이트 서버리스)

> draw.io source: [`architecture-diagram.drawio`](./architecture-diagram.drawio) · region `ap-northeast-2`
> 스크립트 모드(기본) + 라이브 모드(옵션)가 **동일 AppSync 계약**을 공유. SSOT: `hk-skills/reference/STACK.md` + `ARCHITECTURE.md`.

## 🟢 비개발자용 쉬운 설명 (먼저 읽으세요)

### 한 문장 요약
> 부스에서 **버튼만 누르면 똑같은 상담 시연이 매번 안정적으로 재생**되도록 만들고, 원할 때 **진짜 AI로 돌리는 모드**를 토글 하나로 얹은 구조입니다.

### 왜 이렇게 만들었나? (핵심 결정 3가지)
- **"항상 똑같이 재생"을 1순위로.** 부스는 와이파이가 끊기거나 AI가 느려질 수 있는 환경입니다. 그래서 기본은 **미리 녹화해 둔 시나리오(scenario.json)를 그대로 트는 "스크립트 모드"**예요. 시연이 절대 망가지지 않습니다.
- **"진짜 AI"도 보여줄 수 있게.** 심사/관람객에게 어필할 땐 토글 한 번으로 **"라이브 모드"**로 전환 — 실제 음성인식·AI 답변·음성합성이 돌아갑니다. 두 모드가 **똑같은 통로**를 쓰기 때문에 화면(프론트엔드)은 둘을 구분조차 못 합니다.
- **가볍게, 관리 부담 없이.** 24시간 켜둬야 하는 무거운 서버는 안 씁니다. **요청이 올 때만 잠깐 켜지고 알아서 꺼지는** 방식(서버리스)이라 부스 데모에 딱 맞고, 비용·관리가 거의 안 듭니다.

### 각 구성요소가 하는 일 (식당에 비유)
| 구성요소 | 쉬운 역할 | 비유 |
|---|---|---|
| **브라우저 화면** | 상담원·관리자가 실제로 보는 웹 화면 | 손님이 보는 **메뉴판/테이블** |
| **CloudFront + Amplify** | 그 웹 화면을 빠르고 안전하게 띄워주는 곳 | 음식을 내가는 **홀/서빙** |
| **AppSync** | 화면과 백엔드가 대화하는 **유일한 창구**. 새 소식이 생기면 화면에 자동으로 밀어줌 | 주문을 받고 결과를 알려주는 **종업원** |
| **Lambda (orchestrator)** | "다음에 무슨 일이 일어날지" 결정하는 두뇌. 스크립트 재생 or 진짜 AI 호출 | 주문을 요리로 바꾸는 **주방장** |
| **DynamoDB** | 통화·발화·분석 결과를 저장하는 데이터 창고 | 재료와 기록을 보관하는 **냉장고/장부** |
| **S3** | 시나리오 파일·음성 mp3 같은 큰 파일 보관소 | 큰 식자재 두는 **창고** |
| **Bedrock (Converse·Guardrails)** | 실제 AI 답변 생성 + 부적절한 말 자동 차단 | 요리하는 **AI 셰프 + 위생 검사관** |
| **Transcribe** | 고객 음성을 글자로 받아쓰기 (라이브 모드) | 손님 말을 받아적는 **속기사** |
| **Typecast** | AI 답변을 사람 목소리로 읽어줌 (외부 서비스) | 안내방송 **성우** |
| **IAM · CloudWatch** | 누가 뭘 할 수 있는지 권한 관리 + 문제 생기면 알림 | **경비원 + CCTV** |

> 더 자세한 기술 흐름은 아래 영문/기술 섹션 참고. 위 표만 이해해도 데모 설명에는 충분합니다.

---

## Flow (primary path)

1. **Browser (관리자/상담원 UI)** → **CloudFront** — HTTPS / WSS (GraphQL over WebSocket)
2. **CloudFront** → **Amplify Hosting** (Next.js 15 SSR/ISR)
3. **Amplify** → **AppSync (GraphQL)** — 뮤테이션(`createCall`·`dialCall`·`nextTurn`) + 구독 푸시
4. **Amplify** → **S3** — 정적 시나리오 로드 (dashed)
5. **AppSync** → **DynamoDB** — resolver 직결 (read/write)
6. **AppSync** → **Lambda orchestrator** — Lambda 데이터소스
7. **Lambda** → **DynamoDB** — turn/MOT/compliance write
8. **Lambda (script mode)** → **S3** — `scenario.json` read (dashed)
9. **DynamoDB Streams** → **AppSync** — 구독 팬아웃 *(⏳ Streams는 켜져 있으나 팬아웃 소비자는 미구현 — BACKEND-009/#28에서 연동)*

## Flow (live mode, optional — dashed)

10. **Lambda (live mode)** → **Transcribe** (STT, ko-KR)
11. **Lambda** → **Bedrock Converse** (LLM, `global.anthropic.claude-sonnet-4-6`)
12. **Lambda** → **Bedrock Guardrails** (컴플라이언스 검수 루프, 최대 2회 재작성)
13. **Lambda** → **Typecast TTS** (외부 REST, 非AWS · `ssfm-v30` · 혜라/진서/유라)

## Services

| 레이어 | 서비스 | 역할 |
|---|---|---|
| Edge/Hosting | CloudFront + Amplify Hosting | CDN/TLS + Next.js 15 SSR/ISR, git push CI/CD |
| Realtime/API | AppSync (GraphQL) | 프론트↔백 유일 채널 — 구독 + 뮤테이션 |
| Orchestration | Lambda “orchestrator” (Python 3.13) | script mode(기본, scenario.json) / live mode(옵션, 실시간 AI) |
| Data | DynamoDB + Streams | 싱글 테이블 (call·turn·MOT·compliance), Streams→구독 팬아웃 |
| Storage | S3 | scenario.json · 렉시콘 · TTS mp3 |
| AI/Voice (live) | Bedrock Converse · Bedrock Guardrails · Transcribe | LLM · 컴플라이언스 검수 · STT |
| 외부 (非AWS) | Typecast TTS | REST(`X-API-KEY`) TTS, S3에 mp3 저장 |
| Common | IAM · CloudWatch | 최소권한 역할 · 로그/알람 |

## Design decisions

- **Typecast는 AWS 외부 서비스** — AWS Cloud 경계 밖, 점선 박스로 표기.
- **Bedrock Guardrails**는 전용 stencil이 없어 base `bedrock` 아이콘에 라벨로 구분.
- **out of scope**: Fargate / Aurora / Cognito / VPC / WAF / EventBridge (부스 데모 범위 외, `STACK.md` §7).
- 모든 리소스는 **CLOUD-011 (#54)** 단일 CDK 스택에서 프로비저닝 → 후속 issue(#44/#46/#49/#50/#51/#52)가 연동·검증.

## Notes / caveats

- **Amplify 아이콘**: 플러그인 reference 파일에 Amplify stencil 항목이 없어 라이브 aws4 라이브러리의 `mxgraph.aws4.amplify`를 사용함. draw.io에서 빈 박스로 렌더되면 라벨은 유지하고 아이콘만 generic으로 교체할 것.
- 이 환경에 drawio CLI가 없어 PNG 자동 익스포트/육안 검증은 못 함. XML well-formedness는 통과. draw.io 데스크톱/웹에서 열어 아이콘 렌더 확인 권장.
