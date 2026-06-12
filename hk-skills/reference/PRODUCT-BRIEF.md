# PRODUCT-BRIEF — AI Outbound 금융상품 Sales Call Bot

> **Single source of truth for what we are building.**
> **우리가 만드는 것에 대한 단일 진실 공급원입니다.**

---

## 1. 한 문장 요약 / One-line Summary

콜센터 상담원이 **Outbound Call Queue**에서 고객을 선택하면 **AI 봇이 자동으로 전화를 걸어 금융상품을 판매**하고, 필요 시 **실제 상담원에게 통화를 이관**하는 데모 시스템.

A demo system where a call-center agent selects a customer from an **Outbound Call Queue**, an **AI bot auto-calls** to sell a financial product, and **transfers the call to a human agent** when needed.

---

## 2. 사용자 / Users

- **주 사용자 / Primary**: 콜센터 상담원 (Agent) — 한국어
- **대상 / Subject**: 금융 상품 outbound 대상 고객 (데모에서는 가짜 iPhone UI)
- **시청자 / Audience**: 해커톤 심사위원 (데모 평가자)

---

## 3. 핵심 시나리오 / Core Scenarios

세 가지 통화 시나리오, 모두 **상담원 연결 트리거**:

| ID | 이름 | 트리거 조건 | 상담원 행동 |
|---|---|---|---|
| S1 | **가입 희망** | 고객이 상품 가입을 긍정 검토 | 상품 승인 / 거절 |
| S2 | **분노 에스컬레이션** | 고객이 화를 내며 상담원 요청 | 고객 응대 |
| S3 | **사기 의심** | LLM이 금융 사기 패턴 감지 | Fraud 대응 |

세 시나리오 모두 **상담원 연결 큐에 등록**되고, 상담원이 클릭해서 인계.

All three trigger **agent-connection queue** registration. Agent clicks to take over.

---

## 4. 화면 구성 / Screens

### 4.1 상담원 대시보드 (Agent UI)

- **Outbound Call Queue 테이블**
  - 색상 변화: 노란(전화중) / 검정(무응답) / 갈색(거절) / 초록(가입희망) / 빨강(상담원연결요청/Fraud)
  - 빨강/초록은 **요청 시점부터 경과 시간 내림차순으로 고정**
- **통화 화면** (이전 화면에서 행 클릭 시 진입)
  - **좌측 수직**: 통화 노드 그래프 (React Flow). 클릭 시 해당 노드의 transcript가 펼쳐짐.
  - **우측 상단**: LLM 가이드라인 + 통화 연결 사유
  - **우측 하단**: 고객 페르소나/신용/금융 카드
  - **최하단**: 상품 드롭다운 + **가입 승인** 버튼 (거부 버튼은 없음 — 통화 종료는 고객이 결정)
- **통화 종료 후 팝업**
  - LLM이 작성한 메모 초안 (수정 가능)
  - 상담 결과 유형 라디오 박스
  - 확인 시 DB 저장 + 첫 화면 복귀

### 4.2 고객 iPhone UI (Customer Phone UI)

- **받는 화면** (아이폰 스타일): 받기 / 거절 버튼
- **통화 화면**: 통화 시간 타이머 + 종료 버튼
- **실제 소리**: 디바이스 사운드 (Web Audio로 laptop speaker 재생)

> **데모 한계 / Demo limitation**: 실제 핸드폰이 울리지는 않음. 별도 윈도우/탭으로 시뮬레이션. The real phone does not ring — a separate window/tab simulates it.

### 4.3 마이크 채널 토글 (Mic Channel Toggle)

데모에서 상담원과 고객이 같은 마이크를 공유. 상담원 화면에 **"🎙️ 지금 발화자 = [상담원 ↔ 고객]"** 토글이 있고, 이 라벨이 transcript의 speaker에 자동 반영됨.

Demo shares one mic. Agent UI has a toggle "🎙️ Current speaker = [Agent ↔ Customer]" which labels the transcript's speaker.

---

## 5. 비기능 요구사항 / Non-Functional

| 항목 | 요구 | 이유 |
|---|---|---|
| 데모 환경 | 로컬 노트북 (단일 머신) | 24h 안에 클라우드 배포는 risk 큼 |
| 다국어 | 한국어 primary | 심사위원/사용자 한국어 |
| LLM latency | 첫 토큰 < 2초 | 실시간 통화 UX |
| STT latency | < 2초 (chunk 2-3s) | 발화 후 자연스러운 응답 |
| TTS latency | < 1.5초 | 끊김 없는 통화 |
| 데이터 | SQLite (단일 파일) | 설치 단순, 백업 = 파일 복사 |
| 동시 사용자 | 1 상담원 + 1 고객 (데모) | 24h 안에 멀티 유저는 over |

---

## 6. Out of Scope (24h 안에 안 함)

- ❌ 실제 전화망 연동 (Twilio 등) — 시간 부족
- ❌ 다중 상담원 동시 사용 — UI 1세트만
- ❌ 인증/권한 — 데모는 그냥 접속
- ❌ 모바일 반응형 — 데스크톱/노트북 우선
- ❌ 영문 발화 — 한국어만
- ❌ 화자 분리 (Speaker Diarization) — toggle로 대체
- ❌ 푸시 알림, 이메일, SMS
- ❌ 운영 모니터링, 로깅 시스템 (console log로 충분)
- ❌ LLM Fine-tuning, prompt A/B

---

## 7. 성공 기준 / Success Criteria

데모에서 시연 가능한 3가지 흐름:

1. **S1 (가입)**: 상담원이 큐에서 행 클릭 → AI 봇이 가입 권유 → 고객이 긍정 → 상담원 화면으로 인계 → 상담원이 가입 승인 → 메모 저장
2. **S2 (분노)**: AI 봇이 권유 → 고객이 거부 + 화냄 → 상담원 인계 → 메모 저장
3. **S3 (사기 의심)**: 고객이 사기 의심 발언 → LLM이 fraud 감지 → 상담원 인계 → 메모 저장

각 시나리오가 1분 이내에 끝나고, 시각적/청각적으로 자연스러우면 성공.

Each scenario finishes in < 1 minute and looks/feels natural — that is the bar.
