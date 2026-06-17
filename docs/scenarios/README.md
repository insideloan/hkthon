# hk-skills 실사용 시나리오 (Real-World Usage Scenarios)

> **목적 / Purpose**: hk-skills가 24시간 해커톤에서 **실제로 어떻게 쓰이는지**를 시뮬레이션하여, 설계 가정·흐름·엣지케이스를 검증·개선할 수 있도록 합니다.
> 이 문서의 시나리오들은 `docs/MODULES.md`, `docs/WORKFLOW.md`, 각 skill의 SKILL.md를 **그대로 따라가는** 가상 팀의 발자취입니다.

---

## 0. 팀·환경 설정 (시나리오 공통) / Common Setup

| 항목 | 값 |
|---|---|
| 팀 | **수민(A=QUEUE)**, **은경(B=PHONE)**, **주실(C=CALL)**, **지원(D=MEMO)**, **일조(E=ORCH)** |
| 비고 | **일조(E)만 SWE 경력 보유** → 기술 허브인 ORCH(state machine·LLM router·STT/TTS·WS schema) 담당. A~D는 코딩 무경험이라 상대적으로 UI 중심 모듈을 맡고, Claude Code가 구현을 주도 |
| 데모 | AI Outbound 금융상품 Sales Call Bot (PRODUCT-BRIEF 기준) |
| 환경 | 각자 macOS 14, Python 3.12, Node 22, pnpm 9, uv 0.5 |
| GitHub | `https://github.com/aifin-hackathon/hk-2026` (private, 5명 collaborator) |
| Slack 채널 | `#hk-orch` (긴급/PR 알림), `#hk-random` (잡담) |
| 음성 | 디스코드 보이스 채널 "hk-call" (항상 켜놓음) |

### 설치 (Day 0, 0:00)

```bash
# 모든 팀원이 동일하게 실행
git clone https://github.com/aifin-hackathon/hk-skills.git
cd hk-skills
./install.sh
# → ~/.claude/skills/hk-vision, hk-onboard, hk-backlog, hk-slice, hk-implement, hk-verify, hk-demo 심볼릭 링크 확인
```

**검증**: Claude Code 세션에서 "어떤 hk 스킬이 있어?" → 7개 응답.

> **모듈 분리 메모**: 4명 시절엔 균형을 위해 CALL+MEMO를 한 owner(주실)가 맡았으나, 5명이 되면서 CALL(주실)과 MEMO(지원)를 분리. 1인 1모듈 원칙 유지.

---

## 1. 📋 Happy Path 시나리오 (Full 24h, 5명 무사 귀환)

> **이상적인 흐름**. 모든 게 잘 풀리는 케이스. 시간 압박은 있지만 큰 사고 없음.

### 1.1 Phase 1 — Setup & Vision (0:00 - 1:00, 1시간)

#### [0:00] 모든 팀원이 Claude Code 켜고:

**수민 (A)**: "해커톤 시작하자. 제품 정의하자."
→ Claude: `/hk-vision` 자동 호출.

Claude는 5개 질문을 **한 번에 하나씩** 한국어로 던짐:

```
1. "한 문장으로, 이게 뭔가요? 심사위원이 10초 안에 기억할 한 문장."
   → 수민: "콜센터 관리자가 대시보드에서 AI 아웃바운드 콜 대기열·진행 상태를 모니터링하고, AI콜봇이 고객에게 자동 발신해 상품을 1차 안내한 뒤 필요 시 상담원에게 이관하는 시스템입니다."

2. "사용자는 누구인가요?"
   → 은경: "주 사용자는 콜센터 **관리자**예요. 대상 고객은 (가짜) iPhone UI로 표현, AI콜봇은 시스템 내부 행위자, 심사위원은 시청자."

3. "핵심 시나리오 2개는?"
   → 주실: "S1 상품관심·한도조회 요청(→ 상담원 연결), S2 보이스피싱 피해 의심(→ AI콜봇이 위험 안내 후 통화 종료). S1만 상담원 인계, S2는 인계 없이 종료예요."

4. "데모 환경은?"
   → 일조: "노트북 로컬, 1세트. 클라우드 배포 안 합니다."

5. "이번 24시간에 명시적으로 안 할 것은?"
   → 팀 합의: "실제 전화망, 인증, 영문, 상담원 전용 인입 큐, 모바일 반응형."
```

**산출물**: `reference/PRODUCT-BRIEF.md` 자동 갱신. 5명 모두 보고 "OK".

**시간**: 30분. 모두 같은 PRODUCT-BRIEF를 가리킴.

#### [0:30] 각자 `/hk-onboard`

5명이 **각자** 본인 노트북에서:

- Preflight 4개 PASS (claude, python3, node, pnpm)
- `backend/`: `uv init`, `uv add fastapi 'uvicorn[standard]' websockets sqlmodel duckdb pydantic pydantic-settings httpx boto3 openai python-multipart` (DB는 PRODUCT-BRIEF §5대로 **DuckDB 단일 파일**)
- `frontend/`: `pnpm create next-app@latest frontend --typescript --tailwind --app --src-dir --import-alias "@/*" --no-eslint --use-pnpm`
- `pnpm add @xyflow/react lucide-react zustand zod clsx`
- `.env` 작성 (각자): `OPENAI_API_KEY=sk-...` (OpenAI만 쓸 거라 boto3 안 씀)
- Backend stub: `app/main.py`에 `CORSMiddleware(allow_origins=["http://localhost:3000"])` + `/health` endpoint
- Frontend stub: `src/app/page.tsx`에 "Hello from API" + fetch `/health`
- 통합 smoke: backend :8000 + frontend :3000 동시 실행 → 페이지에 "Hello from API" 보임

**시간**: 30분 × 5명 (병렬). 모두 끝나면 `git init` + initial commit.

### 1.2 Phase 2 — Backlog & Slice (1:00 - 3:00, 2시간)

#### [1:00] `/hk-backlog` (5명 함께)

Claude가 백로그 생성:

| ID | Title | Scenario | Type | Owner (TBD) | h | Priority |
|---|---|---|---|---|---|---|
| F01 | Outbound queue table (mock 10명) | cross | FE+BE | A | 1.5 | P0 |
| F02 | iPhone receive/in-call screen | cross | FE+BE | B | 1.5 | P0 |
| F03 | S1 happy path state machine | S1 | BE | E | 2.0 | P0 |
| F04 | Call graph + transcript panel | S1/S2 | FE | C | 2.0 | P0 |
| F05 | Persona/credit/product approval | S1 | FE+BE | C | 1.5 | P0 |
| F06 | S2 보이스피싱 패턴 감지 node | S2 | BE | E | 1.5 | P0 |
| F07 | S2 위험안내 + 자동 통화종료 node | S2 | BE | E | 1.5 | P0 |
| F08 | Memo popup + LLM draft | cross | FE | D | 1.5 | P0 |
| F09 | Mic channel toggle | cross | FE | B | 1.0 | P0 |
| F10 | LLM router (OpenAI ↔ Bedrock) | cross | BE | E | 1.0 | P0 |
| F11 | WebSocket schema + agent/customer WS | cross | BE | E | 1.0 | P0 |
| F12 | Demo seed data (2 시나리오용 + 일반) | cross | BE | E | 0.5 | P0 |
| F13 | TTS 음성 폴리시 (mijin) | polish | BE | E | 0.5 | P1 |
| F14 | State machine 노드 그래프 시각화 polish | polish | FE | C | 1.0 | P1 |
| F15 | Demo fallback (LLM timeout 시 hardcoded) | polish | BE | E | 1.0 | P1 |

**P0만 = 12개, 약 16h**. P0+P1 = 18.5h. 24h 안에 P0 + 대부분 P1 가능.

> **ORCH 부하 메모**: BE/state machine/LLM/WS 작업(F03·F06·F07·F10·F11·F12)이 유일한 SWE인 일조(E)에게 몰려 있음. E는 가장 먼저 시작하고(특히 F11 WS schema), A~D는 Claude Code 주도로 각자 UI 모듈을 병렬 진행. 통합 단계에서 E가 병목이 되지 않도록 schema PR을 초반에 머지하는 것이 핵심.

`BACKLOG.md` 작성, 5명 모두 "OK" → 합의.

#### [1:30] `/hk-slice` (F01 → F05 순서로, 5명 함께)

Claude가 F01 (Outbound queue table) → 2-3개 issue로 분해:

```yaml
- id: QUEUE-001-outbound-table-component
  module: QUEUE
  owner: Person A (수민)
  est_h: 1.0
  files_expected:
    - frontend/src/components/queue/OutboundQueueTable.tsx
    - frontend/src/stores/queueStore.ts
  acceptance:
    - 페이지에 row 10개 표시 (mock data), 기본은 일반 리스트
    - 상담원 연결 필요/금융사기 의심 행만 빨강 강조 + 전환 시점 기준 경과시간 내림차순으로 상단 고정 (PRODUCT-BRIEF §4.1)
    - row 클릭 시 실시간 통화 모니터링 화면(/call/[id])으로 진입 (콜 시작이 아니라 모니터링 진입)
    - (상단) 요약 카드: 대기콜/진행중/상담원연결필요/사기의심/종료 수

- id: QUEUE-002-queue-api-mock-endpoint
  module: QUEUE
  owner: Person A (수민)
  est_h: 0.5
  files_expected:
    - backend/app/api/queue.py
    - backend/app/models/customer.py
  acceptance:
    - GET /api/queue → 10개 customer JSON
    - DB 초기화 + 시드 1회 실행 OK

- id: ORCH-001-state-machine-skeleton
  module: ORCH
  owner: Person E (일조)
  est_h: 1.0
  files_expected:
    - backend/app/scenarios/state_machine.py
    - backend/app/main.py  # router include
  acceptance:
    - state machine class, DIALING → ENDED 전이 정의
    - 1개 unit test 통과
```

**모듈 boundary 검증**: Claude가 `docs/MODULES.md` §2 matrix를 보고 모든 파일이 owner 모듈 안인지 확인. 모두 OK.

`gh issue create` × 3, `OWNER.md` 업데이트. 라벨: `status:ready,module:queue,priority:p0`.

같은 방식으로 F02 ~ F12까지 slice → 약 25-30개 issue 생성. 5명 합의.

**시간**: 1.5시간. 모든 issue가 `status:ready`로 GitHub Project에 등록됨.

### 1.3 Phase 3 — Build (3:00 - 21:00, 18시간, 핵심)

#### [3:00] 5명 동시 시작. 수민 (A) 가 QUEUE-001부터:

**수민**:
> "이제 구현 시작. QUEUE-001 작업할게."

→ Claude: `/hk-implement` 호출.

```
[3:05] Pre-flight: gh issue view 1 → QUEUE-001 확인
[3:07] Issue status: ready → in-progress
[3:08] git checkout -b QUEUE-001-outbound-table-component origin/main
[3:10] PLAN 제시:
  1. frontend/src/components/queue/OutboundQueueTable.tsx - 테이블 컴포넌트
  2. frontend/src/stores/queueStore.ts - zustand store (mock data 10개)
  3. frontend/src/app/page.tsx - table import + 표시
[3:12] 수민: "OK 시작합시다"
[3:15-4:30] 구현 (75분)
[4:30] 중간 점검: "30분 지났습니다. acceptance 중 50% 끝났나요?" → YES
[4:45] Acceptance 자가 검증:
  - pnpm dev → row 10개 표시 OK
  - 강조(빨강) 행 상단 고정 + 경과시간 정렬 동작 OK (개발자 도구로 className 확인)
[4:50] docs/slices/QUEUE-001/VERIFY.md 작성
[4:55] git add . && git commit && git push -u origin HEAD
  → pre-push hook: ✅ all files belong to QUEUE module
[5:00] gh pr create --title "[QUEUE] outbound table component" --reviewer @jusil
[5:02] Issue: in-progress → in-review
[5:03] Hand-off 메시지: "✅ QUEUE-001 구현 완료, PR #1, Reviewer @jusil"
```

#### [3:00-21:00] **5명이 위 루프를 18시간 동안 반복**

대략적인 분포:
- **수민 (A, QUEUE)**: 6 issue, 약 6-7시간
- **은경 (B, PHONE)**: 5 issue, 약 5-6시간
- **주실 (C, CALL)**: 6 issue, 약 6-8시간
- **지원 (D, MEMO)**: 4 issue, 약 4-5시간
- **일조 (E, ORCH)**: 7 issue, 약 7-9시간 (유일한 SWE → BE/state machine/LLM/WS 집중)

#### [3:00] **ORCH schema PR이 가장 먼저 머지되어야 함 (ORCH-001-schema-and-ws)**

일조가 `ORCH-001`를 가장 먼저 시작. `backend/app/ws/agent_ws.py`, `backend/app/ws/customer_ws.py`, `frontend/src/types/ws.ts`에 schema 정의.

**PR #2 [ORCH] WS schema + agent/customer WS**:
- 일조가 raise, reviewer: 수민 (QUEUE 사용), 은경 (PHONE 사용)
- 30분 SLA (TEAM LOCK 또는 schema PR)
- 30분 후 approve × 2 → squash merge
- 이후 다른 모듈들이 이 schema에 맞춰 작업

#### [6:00, 9:00, 12:00, 18:00, 22:00] 5분 sync (standup)

- 0h: setup
- 6h: "각자 2-3 issue 끝냄. P0 중 30% done"
- 12h: "P0 중 60% done. S1 happy path 동작 확인"
- 18h: "P0 100% done. 통합 시작"
- 22h: "통합 + 데모 리허설"

#### [12:00] **첫 통합 milestone**: S1 happy path 동작

`backend` + `frontend` 동시 실행 → queue → S1 시뮬레이션 → 상담원 인계 → 상품 승인 → 메모 저장.

#### [18:00] **P0 done**, 통합 phase 시작

`/hk-verify`의 §8 통합 단계:
- S1, S2 풀 플로우를 1명이 처음부터 끝까지 1번씩 클릭
- 충돌 발견 시: shared file rebase 또는 data format fix

#### [21:00] 모든 P0 done + 통합 OK. 다음: 데모 준비.

### 1.4 Phase 4 — Demo (21:00 - 24:00, 3시간)

#### [21:00] `/hk-demo`

Claude가 `DEMO.md` 작성:

```markdown
# 데모 시나리오 (4분)

## 타임라인
| 시간 | 무엇 | 누가 | 화면 |
|---|---|---|---|
| 0:00 | intro (수민) | 슬라이드 | "AI가 직접 전화합니다" |
| 0:15 | queue | 수민 | agent UI / |
| 0:30 | click row | 수민 | customer iPhone (별도 탭) |
| 0:45 | S1 happy | (자동) | 양쪽 동시 |
| 1:30 | 인계 | 주실 | agent UI call/[id] |
| 1:50 | 노드 그래프 | 주실 | call view 좌측 |
| 2:10 | 페르소나 + 승인 | 주실 | call view 우측 |
| 2:30 | 메모 | 지원 | popup |
| 2:50 | S2 (보이스피싱) 압축 | (자동) | 양쪽 |
| 3:30 | AI 위험안내 후 자동 통화종료 + 요약 | (자동) | 양쪽 |
| 3:50 | 마무리 | 수민 | 슬라이드 |
```

> **S2는 상담원 인계 없이** AI콜봇이 피싱 위험을 안내하고 통화를 종료 → 종료 요약 화면으로 마무리 (PRODUCT-BRIEF §3, §7).

폴리시 5개 영역 점검:
- **A 시드**: `python -m app.seed` → 고객 10명 (S1×4, S2×4, 일반×2)
- **B fallback** 3개: LLM timeout, STT 끊김, WS reconnect
- **C 셋업**: chrome 창 2개 (`/`, `/phone`), DND ON, 밝기 max
- **D polish**: TTS mijin, 노드 그래프 줌 1.5배, memo 예시 1-2개
- **E 시간**: 리허설에서 4분 확인

#### [22:30] **리허설 1회** — 4분 15초 (약간 초과)
- 슬라이드 전환이 5초 늦음
- S2 압축 데모에서 1번 멈칫
- **discussion 5분** (5명):
  - 잘 된 것: queue 색상(강조 행 상단 고정), 노드 그래프
  - 막힌 것: S2에서 "보이스피싱 패턴" 트리거가 1번 실패 (LLM JSON parse)
  - polish: 슬라이드 단축, S2 5초 더 짧게

#### [23:30] **리허설 2회** — 3분 50초 OK

#### [24:00] 발표 🎤

**결과**: 4분 데모 + 5분 Q&A. 심사위원 5명 중 3명이 "특히 노드 그래프가 인상적" 피드백. **우승 후보**.

---

## 2. ⚠️ Edge Case 시나리오 (함정·충돌·실수)

> **실제 해커톤에서 거의 반드시 일어나는 일들**. hk-skills가 이런 상황을 어떻게 흡수하는지 확인.

### 2.1 Edge: 모듈 boundary violation (pre-push hook 발동)

**시간**: [5:30], QUEUE-002 작업 중.

**상황**: 수민이 `backend/app/ws/agent_ws.py`를 손대는데, 이 파일은 **QUEUE 모듈**이라 자기 모듈이긴 함. 하지만 schema 변경이라 `ORCH-XXX-schema-change`로 따로 issue가 있어야 함.

**Code**:
```python
# backend/app/ws/agent_ws.py (수민이 실수로 수정)
async def send_queue_update(...):
    await ws.send_json({"type": "queue_update_v2", ...})  # ← v2 추가
```

**Push**:
```bash
git commit -am "feat(QUEUE-002): add queue update"
git push -u origin HEAD
```

**Pre-push hook 결과**:
```
[check] module: QUEUE (Person A)
[check] SSOT:   docs/MODULES.md (28 patterns loaded)
[check] 3 file(s) changed:
  - backend/app/api/queue.py             [yours]
  - backend/app/models/customer.py       [yours]
  - backend/app/ws/agent_ws.py          [yours]    ← OK (QUEUE 모듈 파일)
[check] ✅ all 3 file(s) belong to module 'QUEUE'
```

→ Push는 통과. **하지만** schema 변경(`queue_update_v2`)이라 다른 모듈(PHONE 등)이 broken.

**수민의 대응**:
1. `git log` 보고 schema 변경임을 인지
2. `git revert HEAD` → 새 branch `ORCH-005-ws-schema-v2` 생성
3. `/hk-slice`로 ORCH owner(일조)에게 handoff
4. 일조가 schema PR → reviewer: 수민 + 은경 → 머지
5. 수민은 QUEUE-002 브랜치 rebase → 새 schema 맞춰 재작업

**학습**: pre-push hook은 **모듈 ownership만** 체크, **schema 일관성은 못 체크**. 사람이 인지해야 함.

**SKILL.md 보완**: `hk-implement` §3.4에 "schema 변경이 필요해지면 issue를 새로 만들고 ORCH에 handoff" 명시됨 (이미 있음). 추가 강화 가능.

---

### 2.2 Edge: 다른 사람 PR 머지 안 됨 (1h SLA 위반)

**시간**: [10:00], 일조의 ORCH-003 (state machine S1) PR이 떠 있음.

**상황**:
- 일조: PR #5 [ORCH] S1 state machine. Reviewer: 수민, 주실.
- 수민: 자기 QUEUE-003 작업 중 (3시간 짜리 큰 issue, 거의 끝나감)
- 주실: 30분간 자리비움 (점심)
- 1시간 후: review 0건
- 일조: 슬랙 ping → 응답 없음
- 1.5시간 후: 일조가 음성으로 "PR #5 review 부탁" 알림
- 수민: "아 미안 지금 끝나면 볼게" → 30분 더
- 2시간 후: 수민 approve + 머지
- 주실: 1시간 후 approve (이미 머지됨)

**영향**:
- 주실의 CALL-002 (call graph)가 ORCH schema를 기다리며 **2시간 blocking**
- 주실: status:in-progress issue는 1개만 가지니까 → 다른 이슈 진행. 1.5시간은 다른 곳에서 못 박음.
- ORCH는 유일한 SWE(일조)가 담당하는 허브라 다른 모듈이 schema를 기다리는 blocking이 특히 자주 발생 → 일조의 PR을 최우선 review.

**학습**:
- 1h SLA는 의도. 24h에 1시간은 길다.
- 일조는 30분 후 voice ping으로 **즉시 알림**했어야 함.
- 주실은 PR이 안 머지되면 issue status를 `status:blocked`로 표시.

**SKILL.md 보완**: `hk-implement` §7에 "30분 후 review 없으면 음성 ping, 1h 후에도 없으면 그 PR을 rebase해서 직접 머지 (TEAM LOCK 아니면)" 추가 가능.

---

### 2.3 Edge: 1인이 2개 in-progress issue (1인 1이슈 위반)

**시간**: [15:00], 주실이 CALL-003 끝내고 CALL-004 시작. 1시간 후 지쳐서 다른 P1 (CALL-009 polish)도 시작.

**상황**:
- 주실: status:in-progress = CALL-004, CALL-009 (2개)
- GitHub Project 보드에서 빨간 라벨 (위반)
- 22h 시점에 CALL-004가 80% 완성, CALL-009는 50%

**수민의 발견**:
- 22h sync에서 "야 주실, in-progress 2개 아닌가?"
- 주실: "아 그러네" → CALL-009 close (P1이라 시간 없음)

**학습**: 1인 1이슈는 의도. 24h에 context switching = disaster. SKILL.md에 명시됨.

**SKILL.md 개선**: OWNER.md에 사람이 in-progress issue를 **2개 가지면 빨간색** 자동 표시하는 lint script 추가 가능.

---

### 2.4 Edge: TEAM LOCK 파일 (package.json) 실수로 push

**시간**: [7:00], 수민이 QUEUE-003에서 새 npm dep (`date-fns`)을 install하고 push.

**Pre-push hook 결과**:
```
[check] module: QUEUE (Person A)
[check] 1 file(s) changed:
  - frontend/package.json          ← TEAM-LOCK

[check] ⚠️  Review TEAM-LOCK / unowned changes carefully before merging.
[check] 1 TEAM-LOCK file(s) — these need a PR with all approvals:
  - frontend/package.json
```

→ Push는 **block**됨. exit 1.

**수민의 대응**:
1. hook 메시지 확인
2. `git checkout -- frontend/package.json` (의도한 dep 변경 revert)
3. issue `INFRA-001-add-date-fns` 생성, 본문에:
   - "왜 STACK에 있는 luxon으로 안 되는지" (사실 안 됨, luxon은 우리 stack에 없음. STACK에 dayjs 있음)
   - "추가 안 하면 24h 안에 못 끝나는 이유": "통화 시간 formatter 편하게 하려고"
4. 5명 합의 (TEAM LOCK은 모두 approve)
5. 머지 후 본인 QUEUE-003 rebase → 다시 push

**학습**: STACK.md §2에 dayjs가 있음. 24h엔 새로 dep 추가 안 하는 게 안전. SKILL.md §4에 "추가 안 함이 default" 명시됨.

---

### 2.5 Edge: Schema 변경 합의 없이 push (ORCH가 CALL schema 변경, CALL이 update 안 함)

**시간**: [14:00], 일조가 ORCH-007 (call transcript schema 변경) push + 머지. **CALL 모듈(주실)은 모름.**

**상황**:
- 일조: `transcript` WS 메시지에 `confidence` 필드 추가
- 머지 30분 후
- 주실: CALL 화면에서 transcript panel 안 보임 (TypeScript error: `confidence` required)

**주실의 발견**:
```bash
$ pnpm tsc --noEmit
src/components/call/TranscriptPanel.tsx:42:18 - error TS2741: Property 'confidence' is missing in type ...
```

**주실의 대응**:
1. `git log origin/main` → 일조의 schema PR 발견
2. 음성으로 일조에게 ping: "야 schema 변경 합의 있었어?"
3. 일조: "아 미안, 5분 voice로 설명할게" → 합의 (confidence optional로 변경)
4. 일조가 다시 PR로 optional로 fix
5. 주실은 type fix 후 작업 재개

**학습**: WORKFLOW.md §3.1에 "Schema 변경 PR은 ORCH owner + 사용 모듈 owner 2명 approve" 명시. 일조가 이를 무시. 24h에 흔한 실수.

**SKILL.md 개선**: `hk-implement` §6에 "WS 메시지 schema 변경 시 **반드시** PR 본문에 'Affected modules' 명시 + reviewer에 사용 모듈 owner" 강조.

---

### 2.6 Edge: rebase conflict (3명이 같은 backend/app/main.py 수정)

**시간**: [16:00], 수민·주실·지원 3명이 각각 QUEUE/CALL/MEMO PR에서 `backend/app/main.py` 수정 (router include).

**상황**:
- 수민: `app.include_router(queue_router)` 추가
- 주실: `app.include_router(calls_router)` 추가
- 지원: `app.include_router(memos_router)` 추가
- main이 충돌: 3명이 같은 위치(40-50번째 줄)에 router include

**수민의 conflict**:
```bash
$ git fetch origin
$ git rebase origin/main
Auto-merging backend/app/main.py
CONFLICT (content): Merge conflict in backend/app/main.py
```

**수민의 해결**:
```python
# main.py
# 1. 수민의 변경
app.include_router(queue_router)
# 2. 주실의 변경 (이미 main에 있음)
app.include_router(calls_router)
# 3. 지원의 변경
app.include_router(memos_router)
```

→ `git add main.py && git rebase --continue && git push --force-with-lease`

**학습**: rebase는 일상. `--force` 절대 금지, `--force-with-lease`만.

**SKILL.md에 잘 명시됨**. 추가 개선: 충돌 패턴이 자주 일어나면 → ORCH owner가 `app/main.py`를 한 번에 정리하는 follow-up issue 만들기.

---

### 2.7 Edge: hk-verify FAIL → hk-implement 회귀

**시간**: [19:00], 주실이 CALL-005 (product approval) PR. Reviewer: 수민 (QUEUE 사용).

**Reviewer verify**:
- A섹션 (lint/tsc): PASS
- B섹션 (acceptance): 부분 FAIL
  - API 200 OK ✅
  - **DB에 row 생성이 안 됨** ❌ (DuckDB 파일 쿼리로 확인)
- C섹션: PASS

**수민의 FAIL 처리**:
```bash
gh pr review 12 --request-changes --body "## What
- VERIFY.md B#2: POST /api/calls/{id}/approve 200이지만 calls 테이블에 approval row 생성 안 됨 (DuckDB 파일 쿼리로 확인)
- 예상: row created with product_id
- 실제: row 0 created

## How to fix
- backend/app/api/calls.py의 approve endpoint에서 SQLModel session.add 누락 가능성
- 디버깅: endpoint 진입 시 print, session.add 후 commit 호출"
```

```bash
gh issue edit 12 --remove-label "status:in-review" --add-label "status:in-progress"
```

**주실의 회귀**:
1. 음성으로 수민에게 "FAIL 인지, 30분 안에 fix"
2. `/hk-implement` (같은 issue, 회귀)
3. PLAN: `backend/app/api/calls.py`의 session 누락 확인
4. Fix: `session.add(approval); await session.commit()` 추가
5. 재검증, PR 코멘트: "Fixed in latest commit, please re-verify"
6. 수민: 5분 후 재리뷰 → PASS → merge

**학습**: 24h에 hk-verify FAIL은 정상. 1-2시간 단위 루프가 빨라야 함. SKILL.md §3.10에 명시됨.

---

### 2.8 Edge: 18h 시점 P0 50% 미만 (시간 압박)

**시간**: [18:00], P0 12개 중 6개 done, 6개 in-progress. 6시간 남음.

**대응**:
- **Claude가 자동으로 제안**:
  ```
  "12h 시점 체크 (WORKFLOW.md §5.3):
  - P0 done < 50%? → P1/P2 모두 close
  - P0 done 50-80%? → P1만 close, P2 close
  - P0 done > 80%? → P1 polish 1-2개, P2 close
  
  현재 6/12 = 50% → P1, P2 모두 close 권장.
  P0 in-progress 6개를 6시간 안에 끝내야 합니다.
  
  Option A: P0 6개 모두 끝내기 (각 1시간 목표, 빡빡)
  Option B: P0 4개 + 통합 2시간 (안정)
  Option C: P0 3개 + 부분 데모 (리스크)
  "
  ```

- **팀 합의**: Option B.
  - 5명 모두 P0 in-progress 1개씩 +1 → 총 5-6개 더 끝냄 (각 1-1.5h)
  - 단, ORCH(BE) in-progress가 일조 1명에 몰리면 A~D가 도울 수 없으므로 일조의 P0를 우선 배정
  - 남는 1개 P0는 close (이번엔 skip, 다음 해커톤에서)
  - 통합 2시간, 데모 2시간

**학습**: 24h에 100%是不可能的. P0 80% + 통합 OK가 minimal demo. SKILL.md에 명시.

---

### 2.9 Edge: API key 없음 (.env 비어있음)

**시간**: [4:00], 수민이 OpenAI API key가 없음. 또는 quota 초과.

**상황**:
- LLM router가 401/429 반환
- 통화 시뮬레이션 안 됨

**수민의 hk-verify (B섹션)**:
- LLM 호출 → 500 ERROR
- E섹션 (LLM): 0/3 성공 → FAIL

**대응**:
1. `.env`에 임시로 `OPENAI_API_KEY=sk-fake` → LLM router가 graceful 에러
2. **데모용 fallback**: state machine에 hardcoded script (F15, P1) → LLM timeout 시 자동 전환
3. 이 fallback이 [22:00]에 polish되었으므로 OK
4. 실제 API key는 팀원 1명(B)가 가지고 있으니 공유

**학습**: 24h에 API key 문제는 **반드시** 일어남. fallback이 P1이라도 [22:00] 전에 끝내야 함.

---

### 2.10 Edge: 발표 중 데모 망가짐 (LLM timeout, mic 안 잡힘)

**시간**: [24:00], 발표 중 LLM이 5초 timeout.

**대응 (DEMO.md §3.2 B fallback 1)**:
- 발표자: "음, 잘 보이시죠? (재시도)" → 자동 fallback hardcoded script
- 또는 미리 녹화해둔 30초 비디오로 대체 (DEMO.md §3.2 E)
- WS 끊김 → frontend reconnect logic으로 자동 복구 (C fallback)
- STT 안 됨 → transcript 미리 시드에 심어둔 것으로 보여주기 (D fallback)

**학습**: fallback 3개는 **반드시** 준비. SKILL.md §3.2에 명시.

---

## 3. 🔀 Anti-pattern 시나리오 (하지 말아야 할 것들)

> **실제 해커톤에서 본·들은 실수들**. hk-skills의 가드레일이 어떻게 막는지 확인.

### 3.1 Anti: pre-push hook 우회 (`--no-verify`)

**상황**: 일조가 ORCH-009 (긴급 fix) push 시 hook이 막음. **2시간 소모 후 30분 절약하려고** `--no-verify`.

**결과**:
- main에 PHONE 모듈 파일 + CALL 모듈 파일이 섞여 들어감
- 이후 5명이 rebase 시 1시간씩 lost
- 결국 18h 시점에 `git revert`로 되돌림 → 1시간 더 lost

**hk-skills 가드**: SKILL.md §5, WORKFLOW.md §8에 "절대 금지" 명시. install 시 git config로 alias 줄 수도 있음 (`alias.push='git push --no-verify'` 못 쓰게).

**개선 가능**: setup-project.sh에 git hook **chained** (실수로 우회 못 하게) 추가.

---

### 3.2 Anti: main에 직접 push

**상황**: 수민이 "PR 너무 느려" → `git push origin main` (main은 protected인데 force push 시도).

**결과**:
- GitHub에서 reject (branch protection)
- 5분 lost + 정신적 타격

**hk-skills 가드**: README에 "PR로만 머지" 명시. 실제로 branch protection rules 권장.

---

### 3.3 Anti: 1주일 묵은 PR (1h SLA 무시)

**상황**: 주실의 CALL-006 PR이 2일째 review 안 됨 (수민·일조 busy).

**결과**:
- 주실: 다음 issue 못 시작, 1.5일 lost
- 수민: review 부담 누적, 결국 30분으로 처리

**hk-skills 가드**: WORKFLOW.md §3.2 "1h SLA". OWNER.md에 PR aging 표시.

---

### 3.4 Anti: 새 dep 무한 추가

**상황**: 은경이 PHONE-007에서 `react-spring`, `framer-motion`, `@use-gesture/react` 등 5개 dep 추가 시도.

**결과**:
- TEAM LOCK PR 1개로 합의 시도 → 5명 중 3명 반대
- 1시간 lost
- 결국 `tailwindcss-animate` (이미 설치됨)로 우회

**hk-skills 가드**: SKILL.md §4 "추가 안 함이 default". `reference/STACK.md`에 있는 것만.

---

### 3.5 Anti: 의존성 있는 issue를 동시에 in-progress

**상황**: 
- ORCH-001 (state machine skeleton) → blocked by ORCH-002 (DB schema)
- 일조가 ORCH-001 in-progress, ORCH-002 in-progress (2개)

**결과**:
- 1시간 후 ORCH-001 마무리 → ORCH-002 기다림 → wasted
- ORCH-001은 사실 ORCH-002 끝나야 의미있음 (type import)

**hk-skills 가드**: 1인 1이슈 (SKILL.md §3.4). WORKFLOW.md §1.5.

**개선 가능**: hk-slice가 dependency graph를 그리고 "blocked by 먼저 시작" 경고.

---

### 3.6 Anti: 2명이 동시에 같은 모듈 (CALL)

**상황**: 주실(C, CALL) + 일조(E, ORCH이지만 CALL schema 작업)가 동시에 CALL의 frontend 파일 수정.

**결과**:
- 머지 conflict 2회
- rebase 시간 누적 1시간

**hk-skills 가드**: 모듈 ownership은 OK. WORKFLOW.md §3.5 conflict matrix. "동일 모듈 작업 시 sequencing".

---

## 4. 🎯 Special Scenarios (hk-skills 고유 기능 활용)

### 4.1 Tailwind Template 흡수 (URL 있는 경우)

**시간**: [1:30], hk-onboard 단계. 팀이 `https://github.com/creativetimofficial/notus-nextjs` URL 합의.

**진행**:
1. `/tmp/tailwind-template` 클론
2. 카탈로그 작성: `template Button → src/components/ui/Button.tsx` 등 15개
3. `tailwind.config.ts`의 theme.extend 색상·폰트 옮김
4. queue 강조색(빨강, 상담원 연결 필요/사기 의심)은 `CONVENTIONS.md` §6.2대로 보존
5. 회귀 테스트: `pnpm tsc --noEmit` PASS, `pnpm dev`에서 placeholder 페이지 잘 뜸

**시간**: 30분.

**리스크**: template이 React 18 기반 (우리는 19). → wrapper interface만 차용, template 컴포넌트 직접 import 안 함.

---

### 4.2 Product 변경 (다른 제품에도 적용)

**상황**: 팀이 "AI Outbound Call Bot" 대신 "AI 인바운드 고객 문의 응답 봇"으로 변경 결정.

**진행**:
1. `/hk-vision` 재실행 → PRODUCT-BRIEF.md §1-5 갱신
2. **다른 모든 reference 문서** (ARCHITECTURE, STACK, CONVENTIONS) 영향:
   - ARCHITECTURE.md: state machine 다름 (inbound vs outbound)
   - STACK.md: 동일 (FastAPI + Next.js 그대로)
   - CONVENTIONS.md: queue 색상 다를 수 있음
3. **MODULES.md**: 모듈 다를 수 있음 (queue는 inbound엔 없음)
4. SKILL.md: 시나리오 다름
5. **hk-slice**: feature 분해 처음부터

**시간**: 2-3시간. 24h에 "다른 제품로 갈아끼우기"는 큰 작업. **시작 전에 제품 확정**이 중요.

---

### 4.3 Module 추가 (5 modules → 6 modules)

**상황**: 데모 [20:00]에 "감정 분석 dashboard" 별도 화면 필요해짐. → 새 모듈 `ANALYTICS` 추가.

**진행**:
1. `docs/MODULES.md` §1 + §2 yaml 양쪽 갱신
2. `OWNER.md` Modules 테이블 갱신
3. `setup-project.sh` 재실행 (이미 init된 프로젝트엔 영향 없음, 그냥 OWNER.md 갱신)
4. TEAM LOCK PR (모든 팀원 approve)
5. 새 owner 배정: 5명 중 1명이 ANALYTICS + 기존 모듈 이중 owner (불가피). ANALYTICS는 BE 집계 로직이 있으면 일조(SWE)가, 순수 화면이면 여유 있는 UI owner가 맡음

**시간**: 1시간. 24h에 새 모듈 추가는 거의 없지만, 가능.

---

### 4.4 6명 팀 (6 modules, 1 hub)

**상황**: 한 명이 추가로 합류. 기본 5명(A~E) 위에 6번째 모듈 `ADMIN` (관리자 설정 화면) 추가.

**진행**:
1. `docs/MODULES.md` §1 + §2 yaml 갱신
2. `OWNER.md` 갱신
3. 6명 매핑: Person A→QUEUE, B→PHONE, C→CALL, D→MEMO, E→ORCH, F→ADMIN
4. setup-project.sh --module ADMIN 실행 (Person F)
5. Pre-push hook: Person F는 ADMIN만 push 가능
6. F가 코딩 무경험이면 ORCH/schema 의존 작업은 일조(E)와 짝지어 진행

**시간**: 30분. hk-skills는 4~6명 모두 지원 (README §1).

---

## 5. 📊 시나리오 검증 체크리스트 (이 문서의 목적)

> 이 시나리오 문서가 **"제대로 된 시나리오인지"** 확인하는 체크리스트.

### 5.1 Happy Path 검증
- [ ] 0:00-1:00 setup: `install.sh` + `setup-project.sh` 동작 OK
- [ ] 0:30 `hk-vision` → PRODUCT-BRIEF.md 5섹션 채워짐
- [ ] 1:00 5명 `hk-onboard` → backend+frontend smoke OK
- [ ] 1:30 `hk-backlog` → BACKLOG.md 8-15 features, P0 ≤ 12
- [ ] 2:00-3:00 `hk-slice` → 25-30 issues, 모두 `status:ready`
- [ ] 3:00-21:00 5명 `hk-implement` ↔ `hk-verify` 루프
- [ ] 12:00 첫 통합 milestone (S1 happy path 동작)
- [ ] 18:00 P0 100% done + 통합 phase
- [ ] 21:00 `hk-demo` → DEMO.md 4분 타임라인
- [ ] 22:30 리허설 1회 → 4분 15초 → 조정
- [ ] 24:00 발표

### 5.2 Edge Case 흡수
- [ ] 모듈 boundary violation: pre-push hook이 block
- [ ] 다른 사람 PR 1h SLA: voice ping으로 해결
- [ ] 1인 2 in-progress issue: sync에서 발견, 1개 close
- [ ] TEAM LOCK 파일 실수 push: hook이 block, INFRA issue 생성
- [ ] Schema 변경 합의 없음: tsc error로 발견, voice 합의
- [ ] Rebase conflict 3명: 각자 해결 (router include 3개)
- [ ] hk-verify FAIL: hk-implement 회귀, 30분 내 fix
- [ ] 18h P0 50% 미만: P1/P2 close, Option B 합의
- [ ] API key 없음: fallback hardcoded script
- [ ] 발표 중 데모 망가짐: 3개 fallback으로 복구

### 5.3 Anti-pattern 차단
- [ ] `--no-verify` 우회: hook chained, alias 못 쓰게
- [ ] main 직접 push: branch protection
- [ ] 1주일 묵은 PR: OWNER.md에 aging 표시
- [ ] 무한 dep 추가: STACK.md SSOT, INFRA issue
- [ ] 의존성 issue 동시 in-progress: hk-slice가 graph 그려 경고
- [ ] 2명 동시 같은 모듈: OWNER.md sequencing

### 5.4 특수 시나리오
- [ ] Tailwind template 흡수: 30분, wrapper interface만
- [ ] Product 변경: PRODUCT-BRIEF만 갈아끼우기, ARCHITECTURE는 큰 작업
- [ ] Module 추가: MODULES.md yaml + 사람용 표 양쪽, TEAM LOCK PR
- [ ] 6명 팀 확장: README §1이 지원 명시

### 5.5 메타 검증 (시나리오 자체의 품질)
- [ ] 모든 skill (7개)이 시나리오 어디서 호출되는지 명시
- [ ] 5명의 모듈 매핑 (A/B/C/D/E) 일관성
- [ ] 시간 흐름 (0h ~ 24h) 명확
- [ ] Edge case가 **실제로 일어날 법한** 것인지 (DB conflict, LLM timeout, mic 공유 등)
- [ ] SKILL.md/WORKFLOW.md/MODULES.md의 가드레일이 시나리오에서 실제로 발동되는지
- [ ] 개선점 (시나리오에서 발견된 약점)이 문서화되었는지

---

## 6. 시나리오에서 발견된 hk-skills 약점 & 개선 제안

> **이 문서의 진짜 목적**: 시나리오를 돌려보면서 hk-skills 자체의 약점을 발견.

| # | 약점 | 시나리오 | 개선 제안 |
|---|---|---|---|
| 1 | pre-push hook이 schema 일관성을 못 체크 | 2.1, 2.5 | `scripts/check-schema-drift.py` 추가 (WS schema ↔ consumer code) |
| 2 | 1h SLA 위반 시 자동 알림 없음 | 2.2 | GitHub Action: PR open 1h 후 미 review 시 Slack ping |
| 3 | OWNER.md 사람이 in-progress 2개 가지면 빨강 표시 안 됨 | 2.3 | `scripts/lint-owners.py` 추가 (CI 또는 pre-commit) |
| 4 | dep 추가 시 STACK.md에 있는지로 판단 어려움 | 2.4 | `scripts/check-stack-deps.py` (추가 dep이 STACK §2/§3에 있는지) |
| 5 | 12h/18h 시간 체크가 수동 | 2.8 | Cron 또는 GitHub Action이 시간별 알림 |
| 6 | 발표 fallback이 P1 (시간 부족) | 2.10 | P0로 승격 (24h에 fallback은 필수) |
| 7 | hk-slice가 dependency graph 안 그림 | 3.5 | `scripts/slice-graph.py` (Mermaid 출력) |
| 8 | PRODUCT-BRIEF 변경 시 ARCHITECTURE 영향도 분석 없음 | 4.2 | `reference/` 간 cross-reference 자동 검사 |
| 9 | 팀 확장(6명+) 시 pre-push hook 재설치 필요 | 4.4 | `setup-project.sh --module ADMIN`이 한 번에 처리 |
| 11 | SWE가 1명(일조)뿐이라 ORCH/BE가 단일 병목 | 1.2, 1.3, 2.2, 2.8 | hk-slice가 owner별 부하를 합산해 한 명에게 BE가 몰리면 경고; ORCH schema PR을 초반 우선순위로 자동 배치 |
| 10 | 통합 단계 (§8)가 사람 의존 | 1.3 Phase 3 끝 | GitHub Action: main push마다 smoke test 자동 |

---

## 7. 다음 단계

이 시나리오 문서를 **실제 해커톤 전에** 팀 5명과 함께 walkthrough:
1. 5명이 각자 자기 모듈 시나리오를 읽고 "이거 맞나?" 확인
2. 발견된 issue를 GitHub issue로 등록 (이 repo)
3. hk-skills 본 repo에 PR (개선 제안 §6)

이 문서는 **살아있는 문서**: 실전 후 업데이트.
