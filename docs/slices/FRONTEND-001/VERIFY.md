# Verify Checklist — `FRONTEND-001` (관리자 큐 테이블, #30)

> 구현자(주실/FRONTEND)가 A·B를 자가 검증 완료. hk-verify가 C~G를 확인.

---

## A. 코드/자동 검증 / Code & Auto Verify

> 구현자 실행 결과 (이 브랜치 기준, node 20 / pnpm 10.34.4):

- [x] `cd frontend && pnpm typecheck` (tsc --noEmit) — **0 errors**
- [x] `cd frontend && pnpm test` (vitest) — **6 passed / 6**
- [x] `cd frontend && pnpm build` (next build) — **✓ Compiled successfully**, lint+types OK, `/` 정적 생성
- [ ] ~~`ruff` / `seed.py`~~ — 해당 없음 (FRONTEND slice)

---

## B. 수용 기준 (Issue #30 §Acceptance) / Acceptance Criteria

issue의 `## Acceptance` 그대로. 각 줄 = 통과한 테스트:

- [x] **mock 3행 렌더 테스트 통과** — `renders 3 mock rows` (3개 행 + 고객명 3건 검증)
- [x] **상태 배지 클래스 매핑** — `maps state to the semantic badge class` (TRANSFER_PENDING → `escalate` 톤 = queue-escalate 빨강. `BADGE_TONE_CLASS` SSOT 대조)
- [x] **이탈위험 % 표시** — `shows churn risk % when present and a dash when absent` (72% 표시 + 없으면 `—`)
- [x] **`onQueueUpdate` mock 메시지 → 테이블 갱신** — `updates the table when an onQueueUpdate message arrives` (구독 콜백 emit → 2행으로 갱신)

추가 검증:
- [x] 행 `highlight` 강조 — `highlights needs_agent rows` (needs_agent → `bg-red-50`)
- [x] 언마운트 시 구독 해제 — `unsubscribes on unmount`

---

## C. 시각적 확인 (Frontend slice) / Visual Check (FE only)

> hk-verify(비개발자)가 `pnpm dev` 후 확인. (구현자 메모 포함)

- [x] **HTTP 200 + 페이지 렌더**: `/`에서 제목 "AI 상담 코파일럿", 헤딩 "관리자 콜 큐", 테이블 aria-label "아웃바운드 콜 큐" 확인 (curl 스모크)
- [ ] **빈 상태**: 데이터 없을 때 헤더만 표시 (행 0개) — 자연스러움
- [ ] **로딩 상태**: 초기 `queue` 쿼리 동안 (현재 명시 spinner 없음 — 후속 개선 여지)
- [ ] **성공 상태**: 7개 컬럼(고객/상태/단계/이탈위험/담당/시간/채널) 표시
- [ ] **반응형**: 1280×800 깨짐 없음 (`max-w-6xl`)
- [x] **한국어 라벨**: 상태 라벨 한국어 (발신중/통화중/상담원 연결 대기 등), 번역투 없음
- [x] **색상**: queue 색상 `tailwind.config.ts` theme.extend에 의미별 고정 (active=노랑/escalate=빨강/signup=초록 …)

> ⚠️ 실제 AppSync 연동 시각 확인은 백엔드(`queue`/`onQueueUpdate`) 배포 후 가능. 현재는 mock 데이터 기준 단위검증까지 완료.

---

## D. AppSync 구독 메시지 확인 / AppSync Subscription Check

> 실 엔드포인트 배포 후 DevTools WS 탭에서 확인 (BACKEND-003 #22 머지 후).

- [ ] `onQueueUpdate` payload JSON이 `graphql/schema.graphql` `QueueResult`와 일치
- [ ] `queue` 쿼리 응답이 schema와 일치
- [ ] 새로고침 시 구독 자동 재연결
- [x] (구현) 클라이언트는 `frontend/src/lib/appsync.ts` `generateClient()` 단일 클라이언트 경유, zod로 페이로드 parse

---

## E·F. LLM / 외부 API

- [ ] 해당 없음 (FRONTEND 표시 전용 slice)

---

## G. 데모 가능성 / Demoability

- [x] 메인 데모 S1: 관리자 대시보드 콜 큐 = 데모 진입 화면 (`/`)
- [ ] 다른 슬라이스와 통합 (BACKEND `queue`/`onQueueUpdate` 배포 후 e2e)
- [x] `OWNER.md`/issue 상태 `in-review`로 전환 준비됨

---

## 결과 / Result

- [x] **PASS (단위/타입/빌드 레벨)** — A·B 전 항목 통과. C·D의 실 AppSync 연동 항목은 BACKEND(#22) 배포 후 hk-verify에서 확정.

### 알려진 후속 / Follow-ups
- **GraphQL 계약 미확정**: `graphql/schema.graphql`(BACKEND, #22/#49)이 아직 없어 `queue`/`onQueueUpdate` 필드명·타입은 reference/API.md §1.1 + AppSync placeholder 스키마 기준으로 hand-mirror. BACKEND가 실 SDL 발행 시 `types/queue.ts`·`lib/appsync.ts` 쿼리 문자열 대조 필요.
- **deps/config는 TEAM-LOCK**: 이 slice가 추가한 `package.json`(aws-amplify/zustand/zod/clsx + tailwind/vitest devDeps)·`pnpm-lock.yaml`·`tailwind.config.ts`·`postcss.config.mjs`·`vitest.config.ts`·`vitest.setup.ts`는 CLOUD 소유 → **별도 CLOUD PR**로 분리(FRONTEND PR엔 소스만). pre-push hook 통과 위함.
- `churnRisk`는 큐 wire 계약에 **없음** → `onIndexUpdate`를 callId로 join하는 display-only 필드(`queueStore.mergeChurn`). 큐에서 바로 받으려면 BACKEND PR로 `QueueRow.churnRisk` 추가 논의.
- 초기 로드 spinner/에러 토스트 UI는 후속 slice(FRONTEND-002+)에서 보강.
