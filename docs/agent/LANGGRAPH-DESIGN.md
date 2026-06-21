# LANGGRAPH-DESIGN — 아웃바운드 대출유도 음성봇 Agent 설계

> **소유 모듈**: AGENT (`lambda/orchestrator/agent/*`)
> **상위 SSOT**: `hk-skills/reference/ARCHITECTURE.md` §3, `hk-skills/reference/API.md`,
> `hk-skills/reference/CHURN-RISK-LEXICON.md`, `통화_에이전트_20260620.xlsx`(시나리오 SSOT).
> 충돌 시: 데이터 모양은 `graphql/schema.graphql`, 화면 정의는 `PRODUCT-BRIEF.md`가 우선.
>
> 본 문서는 **라이브 모드(Bedrock Converse + Guardrails + Transcribe + Typecast)** 의
> LangGraph 오케스트레이션 설계다. 스크립트 모드는 `scenario.json` 재생이므로 그래프를 타지 않는다.

---

## 0. 결정 사항 요약 / Decisions

| # | 항목 | 결정 | 근거 |
|---|------|------|------|
| 1 | 단계 모델 SSOT | **xlsx 4단계** 채택 (`IDENTIFY → CONSENT → PROPOSE → CHANNEL` + 공통요건) | 실제 콜 플로우가 가장 구체적 |
| 2 | 산출물 | 설계 + 스켈레톤 코드 | — |
| 3 | 턴 처리 | **하이브리드** — 룰 fast-route → (필요 시) LLM classify+respond | 음성 지연 최소화 + 라우팅 정확도 |
| 4 | state 지속성 | **DynamoDB에서 매 턴 재구성** (no checkpointer) | Lambda stateless, 기존 데이터모델 재사용 |

### 0.1 xlsx 4단계 ↔ ARCHITECTURE.md S1 노드 매핑

xlsx를 SSOT로 삼되, 기존 `ARCHITECTURE.md` §3.2의 노드명과 1:1 매핑해 양쪽 문서를 호환시킨다.

| xlsx 단계 | 그래프 stage (state.stage) | ARCHITECTURE.md S1 노드 | 종료 조건 |
|-----------|---------------------------|------------------------|-----------|
| STEP 1 신원고지/녹취고지 | `IDENTIFY` | `GREETING` | 본인확인 OK → CONSENT / 본인아님·거부 → CLOSING |
| STEP 2 동의/목적안내 | `CONSENT` | `INTRO_PRODUCT` | 동의 → PROPOSE / 거절 → CLOSING |
| STEP 3 상품제안(적합성/중요사항) | `PROPOSE` | `HANDLE_OBJECTION` + `OFFER_SIGNUP` | 진행의사 → CHANNEL / 최종거절 → CLOSING |
| STEP 4 채널선택 | `CHANNEL` | `OFFER_SIGNUP` 종단 | 셀프 → 링크발송·종료 / 상담원 → TRANSFER |
| 공통요건(전 단계) | `COMMON_RULES` (노드 아님, 가드) | classify/transfer 가드 | 전 단계 횡단 |

> **공통요건은 노드가 아니라 모든 노드에 적용되는 가드 규칙**이다(§4.4). 거절·상담원요청·확정멘트 금지는
> `respond` 노드의 시스템 프롬프트 + `fast_route`의 조기 분기로 강제한다.

---

## 1. 그래프 다이어그램 / Graph Topology

```
                         ┌──────────────┐
   nextTurn(callId) ───▶ │ load_context │  DynamoDB에서 Turn 이력 → CallState 재구성
                         └──────┬───────┘
                                │
                         ┌──────▼───────┐
                         │  fast_route  │  룰 기반 조기 분기 (LLM 없음)
                         └──────┬───────┘
              ┌─────────────────┼──────────────────────────┐
   (명확 분기)│                 │(애매 → LLM 필요)            │(무발화)
              ▼                 ▼                            ▼
       ┌────────────┐    ┌──────────────┐            ┌────────────┐
       │  classify  │    │   classify   │            │   silence  │
       │  (skip)    │    │  (LLM 1-call)│            │  (재확인)   │
       └─────┬──────┘    └──────┬───────┘            └─────┬──────┘
             └──────────┬───────┘                          │
                        ▼                                   │
                 ┌─────────────┐                            │
                 │ churn_score │  사전 렉시콘 점수 + (선택)LLM 보정  │
                 └──────┬──────┘                            │
                        ▼                                   │
                 ┌─────────────┐                            │
                 │  route_intent│  ←─── 조건부 엣지 (transfer/fraud/거절/계속) │
                 └──┬───┬───┬──┘                            │
          transfer │   │   │ continue                       │
                   ▼   │   ▼                                ▼
            ┌──────────┐│┌──────────┐               ┌──────────────┐
            │ transfer ││││ respond  │◀──────────────┤ (silence도    │
            │  _node   ││││ (LLM gen)│               │  respond로)   │
            └────┬─────┘│└────┬─────┘               └──────────────┘
                 │  reject    │
                 │  ▼         ▼
                 │ ┌──────┐ ┌────────────┐
                 │ │close │ │ compliance │  Guardrails 루프 (draft→review→redraft)
                 │ │_node │ └─────┬──────┘
                 │ └──┬───┘       ▼
                 │    │     ┌────────────┐
                 │    │     │  detect_mot│  RISK/CONVERSION MOT 판정
                 │    │     └─────┬──────┘
                 └────┴───────────┤
                                  ▼
                           ┌────────────┐
                           │  persist   │  Turn/MOT/Compliance/Call write → Streams
                           └─────┬──────┘
                                 ▼
                               END  (한 nextTurn = 그래프 1회 실행)
```

> **detect_fraud** 는 별도 라우팅 분기가 아니라 `classify` 결과에서 플래그만 세팅 → `persist`가
> `call.fraud_suspected=true` write. 통화는 종료/분기 없이 계속(§4.6).

---

## 2. 실행 모델 / Execution Model

- **1 nextTurn 호출 = 그래프 1회 실행** = 고객 발화 1개에 대한 봇 응답 1개 생성.
- Lambda는 stateless. 매 호출 시 `load_context`가 DynamoDB `CALL#{id}`의 `TURN#*`를 읽어
  `CallState`를 재구성한다(§3, §5). LangGraph checkpointer는 사용하지 않는다.
- 그래프는 `build_graph()`로 조립 후 **모듈 로드 시 1회 compile** 해 인보케이션 간 재사용
  (콜드스타트 비용 절감).

### 2.1 음성 한 턴의 전체 경로 (라이브 모드)

```
[브라우저] 마이크 → audio chunk
   └─ STT (Transcribe ko-KR, stt/transcribe_stt.py) → customer_text
        └─ nextTurn(callId, customerText)  ※라이브 모드는 customerText 동반
             └─ build_graph().invoke(state)   ← 본 설계 범위
                  └─ respond → compliance(approved text)
                       └─ TTS (Typecast, tts/typecast_tts.py) → mp3 → S3
                            └─ 브라우저 재생 + onTurn/onIndexUpdate/... push
```

---

## 3. State 스키마 / CallState

`agent/state.py`의 `CallState`(TypedDict). LangGraph 노드 간 전달되는 단일 상태.

| 필드 | 타입 | 채우는 노드 | 설명 |
|------|------|------------|------|
| `call_id` | `str` | load_context | ULID |
| `customer` | `CustomerCtx` | load_context | 이름·상품·금리/한도·기존대출·차량·신용점수·persona |
| `stage` | `Stage` | load_context/classify | 현재 단계 (IDENTIFY/CONSENT/PROPOSE/CHANNEL/CLOSING) |
| `history` | `list[TurnMsg]` | load_context | 직전 턴들 (speaker, text, node) |
| `customer_text` | `str` | load_context | 이번 턴 고객 발화 (STT 결과) |
| `intent` | `Intent` | fast_route/classify | 분류된 의도 (§4.2) |
| `route` | `Route` | fast_route/classify | 다음 라우팅 결정 (RESPOND/TRANSFER/CLOSE/SILENCE) |
| `classified_by` | `"rule" \| "llm"` | fast_route/classify | 관찰성 |
| `churn_before` | `int` | load_context | 직전 턴 churn_risk |
| `churn_after` | `int` | churn_score | 이번 턴 갱신값 (0–100) |
| `churn_tokens` | `list[Token]` | churn_score | 매칭 키워드 (text, polarity, reason) |
| `emotion` | `str` | classify | 고객 감정 추정 |
| `bot_draft` | `str` | respond | LLM 1차 응답 |
| `bot_text` | `str` | compliance | Guardrails 통과 최종 응답 |
| `compliance_log` | `list[ComplianceStep]` | compliance | drafting→reviewing→...→approved |
| `mot` | `MotResult \| None` | detect_mot | RISK/CONVERSION 판정 결과 |
| `fraud_suspected` | `bool` | classify | 금융사기 의심 플래그 |
| `strategy` | `Strategy` | classify/respond | tactic + headline (StrategyPanel용) |
| `rationale` | `str` | classify/respond | AI 판단 근거 (하단 패널) |
| `next_seq` | `int` | load_context | persist가 쓸 Turn seq |

보조 타입: `Stage`, `Intent`, `Route` (Enum), `CustomerCtx`, `TurnMsg`, `Token`, `ComplianceStep`,
`MotResult`, `Strategy` — `state.py` 참조.

---

## 4. 노드 책임 / Node Responsibilities

### 4.1 `load_context` (LLM 없음)
- DynamoDB `CALL#{id}` 쿼리 → Call META + 전체 `TURN#*` 로드.
- `history` 구성, `churn_before = 마지막 Turn.churn_after`, `stage = 마지막 Turn.node에서 추론`,
  `next_seq = max(seq)+1` 세팅.
- `customer` 컨텍스트는 `CUSTOMER#{id}` 로드.

### 4.2 Intent 분류 체계 / Intent Taxonomy

xlsx의 고객 의도(Intent) 열을 단계 횡단 카테고리로 정규화. fast_route(룰)와 classify(LLM)가 공유.

| Intent | xlsx 매핑 예 | 기본 Route |
|--------|-------------|-----------|
| `IDENTITY_CONFIRMED` | 본인확인됨 | RESPOND (→다음단계) |
| `IDENTITY_FAILED` | 본인아님/타인응답/제3자 | CLOSE (정보 발설 금지) |
| `RECORDING_REFUSED` | 녹취거부 | RESPOND (법적고지 설명) |
| `CONSENT_GIVEN` | 통화지속동의 | RESPOND (→PROPOSE) |
| `INTEREST` | 관심표명·대환관심·진행의사 | RESPOND (적합성 수집) |
| `QUESTION_TERMS` | 금리/한도/조건/리스크/비용 질문 | RESPOND (예시+심사필요 고지) |
| `FRAUD_DOUBT` | 보이스피싱 의심 | RESPOND (객관적 확인경로) + fraud 플래그 |
| `TRANSFER_INTENT` | 상담원 연결 요청·AI거부감 | **TRANSFER** |
| `LIMIT_INQUIRY` | 한도조회 요청 | **TRANSFER** (성공경로) |
| `BUYING_INTENT` | 셀프(디지털) 진행 선택 | RESPOND (링크발송) → CLOSE |
| `OPT_OUT` | 마케팅 동의철회 | CLOSE (철회접수) |
| `REJECTION` | 명시적 거절·즉시종료·욕설 | **CLOSE** (즉시수용) |
| `DEFER` | 나중에/가족상의/바쁨 | CLOSE (재연락 일정) |
| `SILENCE` | 무응답/침묵 | SILENCE (10초 재확인, 3회↑금지) |
| `UNCLEAR` | 위 어디에도 명확히 안 맞음 | (classify LLM로 위임) |

### 4.3 `fast_route` (LLM 없음 — 하이브리드 1단계)
- **목표**: LLM 호출 없이 명확한 케이스를 즉시 라우팅(지연·비용 절감).
- 렉시콘/정규식 기반:
  - HANGUP_INTENT 키워드("끊을게요", "관심없어요", 욕설) → `REJECTION` → Route.CLOSE
  - 상담원/한도 키워드("상담원", "사람 바꿔", "한도조회") → `TRANSFER_INTENT`/`LIMIT_INQUIRY` → Route.TRANSFER
  - STT 공백/최소응답 → `SILENCE`
  - 그 외(질문·반론·애매) → `route = NEEDS_LLM` → classify 노드로.
- `classified_by="rule"` 기록. **공통요건 "거절 최우선"은 여기서 보장**된다.

### 4.4 `classify` (LLM 1-call — 하이브리드 2단계, 조건부)
- `fast_route`가 `NEEDS_LLM`일 때만 실행.
- **단일 Bedrock Converse 호출(structured output)** 로 한 번에:
  `intent`, `route`, `emotion`, `fraud_suspected`, `churn_adjust(±10)`, `strategy{tactic,headline}`, `rationale`.
- 시스템 프롬프트에 **현재 stage + xlsx 해당 단계의 대응전략/금지사항**을 주입(§7).
- `classified_by="llm"` 기록.

### 4.5 `churn_score` (사전 우선, LLM 보정 선택)
- `agent/churn_risk.py`가 `data/lexicon/churn_risk_lexicon.json` 로드 → 사전 점수 계산
  (baseline 50, EMA α=0.6, turn_clamp ±40, negation/intensifier 처리).
- classify가 제안한 `churn_adjust`는 ±10 한도로만 보정. **사전 점수가 1차 진실**.
- `churn_after`, `churn_tokens` 채움.

### 4.6 `respond` (LLM gen)
- Bedrock Converse로 봇 응답 draft 생성. 시스템 프롬프트 = stage별 대응전략 + 공통요건 가드:
  - 확정멘트 금지 → 수치엔 "예시/가정 + 심사결과에 따라 달라짐" 강제
  - 중요사항 누락금지 → 리스크/비용 질문엔 고지요소 포함
  - 선택권 존중, 재설득 금지.
- `bot_draft` 채움.

### 4.7 `compliance` (Guardrails 루프)
- `agent/compliance.py`. ARCHITECTURE.md §3.3 루프:
  `draft → Guardrails.apply → (blocked면 redraft, try<2) → approved`.
- 각 전이 `compliance_log`에 적재 → persist가 ComplianceReview write → `onComplianceState`.
- 최종 `bot_text` 채움.

### 4.8 `detect_mot`
- `agent/mot.py`. RISK MOT: `churn_after - churn_before ≥ +12` 또는 `churn_after ≥ 60`.
  CONVERSION MOT: intent ∈ {TRANSFER_INTENT, LIMIT_INQUIRY, BUYING_INTENT}.
- `triggers`(매칭 키워드), `strategy{tactic,headline}`, `outcome`, `narrative` 구성.

### 4.9 `transfer_node` / `close_node` / `silence` / `persist`
- `transfer_node`: `transferToAgent` 경로 — `state=TRANSFER_PENDING` 전이 페이로드 준비.
- `close_node`: 거절/철회/보류 → 정중한 마무리 멘트 + `state=ENDED` 트리거(엔드콜은 별도 endCall).
- `silence`: 10초 재확인 1회. `history`에서 연속 무응답 2회↑면 종료, 3회 재시도 금지.
- `persist`: Turn/MOT/ComplianceReview/Call(fraud, state) write → Streams 팬아웃.

---

## 5. 라우팅 조건 (조건부 엣지) / Conditional Edges

`route_intent(state) -> str`:

```
if state.route == Route.TRANSFER:  → "transfer_node"
if state.route == Route.CLOSE:     → "close_node"
if state.route == Route.SILENCE:   → "silence"
else (RESPOND):                    → "respond"
```

`fast_route`의 진입 분기:

```
if route == Route.NEEDS_LLM:  → "classify"
elif route == Route.SILENCE:  → "silence"
else:                          → "churn_score"   # 룰로 확정된 transfer/close/respond
```

---

## 6. State 재구성 — DynamoDB / Context Rebuild

`agent/context.py`의 `load_call_state(call_id, customer_text) -> CallState`:

1. `Query PK=CALL#{id}` → META(Call) + 모든 `TURN#{seq}` (정렬).
2. `Query PK=CUSTOMER#{customer_id}` → CustomerCtx.
3. `churn_before = turns[-1].churn_after if turns else 50`.
4. `stage = _infer_stage(turns)` — 마지막 봇 Turn의 `node`/단계 마커에서 추론.
5. `next_seq = (turns[-1].seq + 1) if turns else 1`.
6. `history = [TurnMsg(...) for t in turns[-N:]]` (최근 N턴만, 토큰 절약).

> checkpointer 미사용 → 멱등성: 같은 seq 재호출 시 조건부 write로 중복 방지(persist).

---

## 7. 프롬프트 자원 / Prompt Resources

stage별 시스템 프롬프트는 xlsx에서 파생해 `agent/prompts/` (또는 상수)로 관리:

- `IDENTIFY`: 신원·녹취 고지 의무, 본인아님 시 정보발설 금지, 녹취 임의중단 불가.
- `CONSENT`: 목적 안내, 보이스피싱 의심 시 안심보다 객관적 확인경로, 동의철회 즉시 접수.
- `PROPOSE`: 적합성 수집, **확정 수치 금지(예시/가정+심사)**, 담보·연체·압류·비용 고지요소 누락 금지.
- `CHANNEL`: 셀프 링크발송 / 상담원 이관 / 보류. 디지털 강요 금지, 운영시간(평일 09–18시) 사실 안내.
- `COMMON`: 거절 최우선·확정멘트 금지·중요사항 누락금지·선택권 존중·상담원 우선이관·재시도 금지.

> 프롬프트 본문은 후속 작업에서 xlsx의 "대응전략"/"금지·주의사항" 열을 그대로 인용해 채운다.

---

## 8. 모듈 매핑 / File Map (ARCHITECTURE.md §5 준수)

| 파일 | 역할 |
|------|------|
| `agent/state.py` | CallState + Enum/보조 타입 |
| `agent/graph.py` | `build_graph()` — 노드/엣지 조립 + compile |
| `agent/nodes.py` | 노드 함수 구현 |
| `agent/context.py` | DynamoDB → CallState 재구성 (신규, ARCHITECTURE §5에 추가 필요) |
| `agent/churn_risk.py` | 이탈위험 점수 계산 (렉시콘 로드) |
| `agent/mot.py` | MOT 탐지 |
| `agent/compliance.py` | Guardrails 컴플라이언스 루프 |
| `agent/prompts.py` | stage별 시스템 프롬프트 (신규) |
| `llm/router.py` | Bedrock Converse 래퍼 (structured output) |

> `context.py`, `prompts.py`는 ARCHITECTURE.md §5 파일맵에 없음 → 추가 시 `docs/MODULES.md` PR 필요.

---

## 9. 비기능 / Non-functional

- **지연**: fast_route로 명확 케이스는 LLM 0회. classify+respond는 최대 2 LLM call.
  Bedrock 스트리밍 사용, 첫 토큰 타임아웃 시 `LLM_TIMEOUT` fallback(`API.md` §0.3).
- **결정성/안정성**: churn은 사전 점수 우선(LLM 장애에도 게이지 동작). 데모는 스크립트 모드 기본.
- **관찰성**: `classified_by`, `compliance_log`, `rationale`로 판단 근거 추적.
- **언어**: 모든 사용자-facing 텍스트 한국어(`API.md` §0).
