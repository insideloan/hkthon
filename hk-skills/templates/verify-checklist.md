# Verify Checklist — `<SLICE_ID>`

> **`hk-verify` skill이 채웁니다. 비개발자가 코드 없이 한 줄씩 체크.**
> **`hk-verify` skill fills this out. Non-dev checks line by line, no coding needed.**

---

## A. 코드/자동 검증 / Code & Auto Verify

> Claude가 자동 실행. 결과만 확인하세요.

- [ ] `ruff check lambda/orchestrator/` — 0 errors
- [ ] `mypy lambda/orchestrator` — 0 errors (optional)
- [ ] `pnpm --filter frontend tsc --noEmit` — 0 errors
- [ ] `pnpm --filter frontend lint` — 0 errors
- [ ] `python -m orchestrator.seed` (DynamoDB에 시드 데이터 기록, boto3) — 성공

---

## B. 수용 기준 (Slice Spec §6에서 가져옴) / Acceptance Criteria

slice spec의 §6에서 그대로 복사. 각 줄을 확인:

- [ ] <AC #1>
- [ ] <AC #2>
- [ ] <AC #3>
- [ ] ...

---

## C. 시각적 확인 (Frontend slice) / Visual Check (FE only)

> 비개발자: 두 브라우저 탭(또는 창)을 띄우고 진행.

- [ ] **빈 상태**: 데이터 없을 때 메시지/placeholder 자연스러움
- [ ] **로딩 상태**: spinner 또는 텍스트
- [ ] **성공 상태**: 데이터 표시, 색상/레이아웃 spec과 일치
- [ ] **에러 상태**: 잘못된 입력 시 한국어 에러 메시지
- [ ] **반응형**: 노트북 화면에서 깨짐 없음 (1280×800 기준)
- [ ] **한국어 라벨**: 자연스러운 한국어, 번역투 없음
- [ ] **색상**: queue 색상 (노란/검정/갈색/초록/빨강) 의도와 일치

---

## D. AppSync 구독 메시지 확인 (있는 경우) / AppSync Subscription Check (if applicable)

> 브라우저 DevTools → Network → WS 탭에서 AppSync 구독 소켓 메시지 확인.

- [ ] (AppSync→프론트) 구독 이벤트 type, payload JSON이 `graphql/schema.graphql`과 일치
- [ ] (프론트→AppSync) mutation payload JSON이 schema와 일치
- [ ] (재연결) 새로고침 시 AppSync 구독 자동 재연결

---

## E. LLM 동작 (LLM 포함 slice) / LLM Behavior (if applicable)

> 같은 입력으로 3번 실행했을 때 일관된 결과인지.

- [ ] **System prompt** 가 의도대로 작동
- [ ] **JSON parse** 가 안정적 (3/3 성공)
- [ ] **Streaming** 첫 토큰 < 2초
- [ ] **Bedrock 연결** `.env`의 AWS 자격증명/리전으로 `ChatBedrockConverse` 호출 성공 (Bedrock 전용)
- [ ] **한국어 자연스러움** — 어색한 번역투 없음
- [ ] **가드레일** — forbidden 응답 (욕설, 무관한 답) 안 나옴

---

## F. 외부 API (STT/TTS/LLM 포함) / External API

- [ ] **API key** `.env`에 있고, `.env`가 git에 안 올라감
- [ ] **에러 시** graceful fallback (5xx → 한국어 에러, retry)
- [ ] **Timeout** 5초 이상 응답 없으면 fallback

---

## G. 데모 가능성 (최종) / Demoability (Final)

> **이 슬라이스가 끝나면 데모가 한 단계 진전했는가?**

- [ ] 메인 데모 시나리오(S1)에 이 슬라이스가 들어가 있음
- [ ] 다른 슬라이스와 충돌 없음 (수동 통합 테스트)
- [ ] `OWNER.md` 상태가 `verifying` → `done`으로 바뀔 준비가 됨

---

## 결과 / Result

- [ ] **PASS** — 모든 항목 체크
- [ ] **FAIL** — 실패 항목 있음, hk-implement로 돌아가서 수정

실패 시 어떤 항목이 왜 실패했는지 한 줄 메모:

```
FAIL: <항목> — <사유>
```
