# Verify Checklist — `FRONTEND-011` (AppSync 클라이언트 + Zustand 스토어, #40)

> 구현자(주실/FRONTEND)가 A·B를 자가 검증 완료. hk-verify가 C~G를 확인.

---

## A. 코드/자동 검증 / Code & Auto Verify

> 구현자 실행 결과 (이 브랜치 기준, pnpm):

- [x] `cd frontend && pnpm tsc --noEmit` — **0 errors**
- [x] `cd frontend && pnpm test` (vitest) — **22 passed / 22** (stores 10 + compliance 6 + queue 6 회귀)
- [ ] ~~`pnpm lint`~~ — ESLint 미설정(인터랙티브 설정 프롬프트, 프로젝트 공통 이슈, 본 slice 무관)
- [ ] ~~`ruff` / `seed.py`~~ — 해당 없음 (FRONTEND slice)

---

## B. 수용 기준 (Issue #40 §Acceptance) / Acceptance Criteria

issue의 `## Acceptance` 그대로. 각 줄 = 통과한 테스트:

- [x] **`onQueueUpdate` mock 메시지 → `queueStore` 갱신 테스트** — `queueStore ← onQueueUpdate > updates queueStore when an onQueueUpdate message arrives` (구독 콜백 emit → summary/rows 반영)
- [x] **`onIndexUpdate` mock 메시지 → `callStore.churnRisk`/`emotion` 갱신 테스트** — `callStore ← onIndexUpdate > updates churnRisk/emotion ...` (churnRisk 72 / emotion "불안" 반영). 큐 조인은 `queueStore.mergeChurn`도 별도 테스트
- [x] **재연결 로직 (구독 에러 시 재구독)** — `reconnect on subscription error > resubscribes with backoff after a stream error` (error → 1s backoff 타이머 → 재구독) + `stops reconnecting once unsubscribed` (cleanup 후 좀비 재구독 없음)
- [x] **`ws.ts`/`api.ts` import 없음 확인** — `legacy ws.ts / api.ts removed` 2개 (디스크에 파일 없음 + appsync.ts가 `@/lib/ws`·`@/lib/api` 미import)

추가 검증:
- [x] 잘못된 payload(churnRisk>100 등) → `onError`로 라우팅, 스토어 무변경 — `routes a malformed payload to onError ...`
- [x] transcript/MOT seq 정렬 + 중복 제거 (re-emit 시 in-place 교체) — `keeps turns ordered by seq and dedupes` / `orders MOTs by seq and dedupes`

---

## C. 시각적 확인 (Frontend slice) / Visual Check (FE only)

> 이 slice는 데이터 계층(클라이언트 + 스토어)이라 UI 컴포넌트 없음. 시각 확인은 이 스토어를 소비하는 후속 slice(FRONTEND-012 게이지, 010 MOT 보드 등)에서 수행.

- [ ] N/A — 렌더되는 UI 없음 (lib/stores only)

---

## D. AppSync 구독 메시지 확인 / AppSync Subscription Check

> 실 엔드포인트 배포 후 DevTools WS 탭에서 확인 (BACKEND-009 #28 구독 SDL + Streams 팬아웃 머지 후).

- [ ] (AppSync→프론트) `onTurn`/`onIndexUpdate`/`onSpeechAnalysis`/`onStrategyUpdate`/`onMotDetected`/`onCallEnded`/`onQueueUpdate`/`onComplianceState` payload JSON이 `reference/API.md §2`(SSOT) 및 `graphql/schema.graphql`과 일치
- [ ] (재연결) 소켓 드롭/새로고침 시 자동 재구독 (현재 단위테스트로 backoff 로직 검증 완료, 실 소켓은 배포 후)

> ⚠️ 현재는 API.md §2 계약 기준 mock 단위검증까지 완료. 실 구독 연동은 BACKEND-009(#28) 배포 후 가능.

---

## G. 데모 가능성 (최종) / Demoability (Final)

- [x] 후속 FRONTEND slice(012/009/010/004~007)가 의존하는 실시간 데이터 기반(foundation) — 이 slice가 그 blocker 해소
- [ ] 실 구독 통합은 BACKEND-009(#28) 머지 후 (계약은 API.md §2로 확정)

---

## 결과 / Result

- [x] **PASS (자가검증 A·B)** — tsc 0 errors, 22/22 테스트 통과, acceptance 4/4 충족
- [ ] **FAIL**

> C·D는 실 백엔드(BACKEND-009 #28) 및 소비 UI slice 배포 후 hk-verify가 확인.
