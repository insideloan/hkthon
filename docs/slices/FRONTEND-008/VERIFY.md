# Verify Checklist — `FRONTEND-008` (컴플라이언스 텍스트 패널, #37)

> 구현자(주실/FRONTEND)가 A·B를 자가 검증 완료. hk-verify가 C~G를 확인.

---

## A. 코드/자동 검증 / Code & Auto Verify

> 구현자 실행 결과 (이 브랜치 기준, node 20 / pnpm 10.34.4):

- [x] `cd frontend && pnpm typecheck` (tsc --noEmit) — **0 errors**
- [x] `cd frontend && pnpm test` (vitest) — **12 passed / 12** (compliance 6 + 기존 queue 6 회귀)
- [x] `cd frontend && pnpm build` (next build) — **✓ Compiled successfully**, 정적 생성 OK
- [ ] ~~`ruff` / `seed.py`~~ — 해당 없음 (FRONTEND slice)

---

## B. 수용 기준 (Issue #37 §Acceptance) / Acceptance Criteria

issue의 `## Acceptance` 그대로. 각 줄 = 통과한 테스트:

- [x] **각 상태별 렌더 테스트 통과** — `renders the draft ... (drafting)` / `renders the 4 regulatory checks (reviewing)` / `strikes through ... (redacting)` / `shows the final diff and pass badge (approved)`
- [x] **redacting 시 텍스트 삭제 애니메이션** — `strikes through violations and shows violated policies (redacting)` (위반 span에 `line-through` 클래스 + violatedPolicies 노출)
- [x] **approved 시 최종문 표시** — `shows the final diff and pass badge (approved)` (del 취소선 + ins 빨강 diff, "전 규제 통과" 배지)
- [x] **`onComplianceState` mock 이벤트 → 상태 전이** — `transitions through phases on onComplianceState events` (구독 콜백 emit → data-phase 전이)

추가 검증:
- [x] 규제 검토 플래그 — 수정(flagged)/이상無(pass) 라벨 매핑
- [x] 언마운트 시 구독 해제 — `unsubscribes on unmount`

---

## C. 시각적 확인 (Frontend slice) / Visual Check (FE only)

> hk-verify(비개발자)가 `pnpm dev` 후 확인. (구현자 메모 포함)

- [x] **렌더 스모크**: 임시 프리뷰 라우트(`/compliance-preview`, 커밋 제외)에서 redacting/approved 2상태 HTTP 200 + 핵심 텍스트(가안 위반 강조 / 규제 검토 수정·이상無 / 최종 발화 diff / "전 규제 통과 · 송출 준비") 렌더 확인. (Chromium 미설치로 스크린샷은 생략, curl HTML 검증)
- [ ] **상태머신 연출**: drafting→reviewing→redacting→redrafting→approved 전이 시각 흐름 (실 구독 연동 후)
- [ ] **반응형**: 카드 폭 깨짐 없음
- [x] **한국어 라벨**: 금소법/개인정보법/신용정보법/표현리스크, 수정/이상無, 번역투 없음
- [x] **색상**: danger=위반(빨강)/go=통과(초록), `tailwind.config.ts` theme.extend 팔레트 (reference 디자인 :root 토큰 미러)

> ⚠️ 실제 onComplianceState 연동 시각 확인은 AGENT-010(#18, 컴플라이언스 루프) 배포 후 가능. 현재는 mock 데이터 기준 단위검증까지 완료.

---

## D. AppSync 구독 메시지 확인 / AppSync Subscription Check

> 실 엔드포인트 배포 후 DevTools WS 탭에서 확인 (AGENT-010 #18 머지 후).

- [ ] `onComplianceState` payload JSON이 `graphql/schema.graphql` 계약과 일치
- [ ] 상태 전이가 phase 값에 따라 정확히 반영
- [x] (구현) 구독은 `frontend/src/lib/appsync.ts` `subscribeComplianceState()` 단일 클라이언트 경유, zod로 페이로드 parse

---

## E·F. LLM / 외부 API

- [ ] 해당 없음 (FRONTEND 표시 전용 slice — 컴플라이언스 판정은 AGENT가 산출)

---

## G. 데모 가능성 / Demoability

- [x] consult view 카드③(next action · 컴플라이언스 체크) = "작성→삭제→재작성" 데모 하이라이트
- [ ] consult view 통합 (STT/여정맵/발화분석과 함께, 후속 슬라이스)
- [x] issue 상태 `in-review`로 전환 준비됨

---

## 결과 / Result

- [x] **PASS (단위/타입/빌드 레벨)** — A·B 전 항목 통과. C·D의 실 연동 항목은 AGENT-010(#18) 배포 후 hk-verify에서 확정.

### 알려진 후속 / Follow-ups
- **GraphQL 계약 미확정**: `onComplianceState` 구독이 `graphql/schema.graphql`에 아직 없음(AGENT-010 #18 / BACKEND). reference 디자인(consult_redesigned 카드③) + 추정 계약으로 `types/compliance.ts` hand-mirror. 실 SDL 발행 시 대조 필요.
- **Tailwind 인프라가 이 브랜치에 포함됨 (TEAM-LOCK)**: dev에 Tailwind(config/dep)가 없어(이전 #68 머지 시 누락) 이 slice가 `package.json`(tailwindcss/postcss/autoprefixer + vitest 실행 deps)·`pnpm-lock.yaml`·`tailwind.config.ts`·`postcss.config.mjs`·`vitest.config.ts`·`vitest.setup.ts`를 함께 추가. **CLOUD 리뷰 필요** (pre-push hook은 TEAM-LOCK 차단 → PR로 검증). queue 등 기존 컴포넌트 스타일도 이 인프라로 비로소 실제 적용됨.
- 상태 전이 애니메이션(타이핑/삭제 모션)은 현재 클래스 기반 정적 표현 — 모션 디테일은 후속 폴리시.
