# AI 상담 코파일럿 — AWS 아키텍처 (부스 데모 · 라이트 서버리스)

> draw.io source: [`architecture-diagram.drawio`](./architecture-diagram.drawio) · region `ap-northeast-2`
> 스크립트 모드(기본) + 라이브 모드(옵션)가 **동일 AppSync 계약**을 공유. SSOT: `hk-skills/reference/STACK.md` + `ARCHITECTURE.md`.

## Flow (primary path)

1. **Browser (관리자/상담원 UI)** → **CloudFront** — HTTPS / WSS (GraphQL over WebSocket)
2. **CloudFront** → **Amplify Hosting** (Next.js 15 SSR/ISR)
3. **Amplify** → **AppSync (GraphQL)** — 뮤테이션(`createCall`·`dialCall`·`nextTurn`) + 구독 푸시
4. **Amplify** → **S3** — 정적 시나리오 로드 (dashed)
5. **AppSync** → **DynamoDB** — resolver 직결 (read/write)
6. **AppSync** → **Lambda orchestrator** — Lambda 데이터소스
7. **Lambda** → **DynamoDB** — turn/MOT/compliance write
8. **Lambda (script mode)** → **S3** — `scenario.json` read (dashed)
9. **DynamoDB Streams** → **AppSync** — 구독 팬아웃

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
