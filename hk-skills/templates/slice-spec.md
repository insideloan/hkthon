# Slice Spec — `<SLICE_ID>`

> **한 슬라이스 = 한 사람이 1-2시간 안에 끝낼 수 있는 단위. "데모 가능한가?" 가 끝의 검증 기준.**
> **One slice = one person, 1-2 hours. "Is it demoable?" is the exit criterion.**

---

## 1. 메타 / Meta

```yaml
id: <e.g. S1.3>
title: <한 줄, 무엇을>
owner: <팀원 이름>
status: planned | in_progress | verifying | done | blocked
estimated_hours: 1.5
slice_type: backend | frontend | both
created: 2026-06-11
```

---

## 2. 사용자 스토리 / User Story

```
As a <사용자>,
I want to <행동>,
so that <가치>.
```

예시 (S1.3 — 고객 발화 STT 처리):
```
As a 콜센터 시스템,
I want to 고객의 음성을 텍스트로 변환해서 발화 의도를 파악,
so that AI 봇이 적절한 응답을 생성할 수 있다.
```

---

## 3. UI / UX (있으면)

스크린샷 또는 ASCII sketch:

```
+-------------------------------------+
|  (그리기)                            |
+-------------------------------------+
```

색상, 폰트, layout 자유.

---

## 4. 데이터 / Data

- 영향받는 테이블: `customers`, `calls`, `transcripts`, ...
- 새로 만들 테이블: (있으면 schema)
- 영향받는 env vars: (있으면)

---

## 5. 의존성 / Dependencies

- **blocks** (이게 끝나야 시작): `S1.1`, `S1.2`
- **blocks this** (이게 시작해야 함): `S1.5`
- **shared files** (다른 사람과 동시에 작업 시): 없음 / `backend/app/ws/agent_ws.py` (합의 필요)

---

## 6. 수용 기준 (Acceptance Criteria) / Acceptance Criteria

각 항목이 **체크 가능한 진술**:

- [ ] (BE) `POST /api/foo` 호출 시 200 + 정확한 JSON 응답
- [ ] (FE) 페이지 진입 시 row 1개 표시, 색상 정확
- [ ] (WS) `/ws/agent`에서 `queue_update` 메시지 수신
- [ ] (DB) row가 SQLite에 저장됨
- [ ] (LLM) `llm/router.py`가 bedrock/openai 양쪽에서 동일 응답
- [ ] (i18n) UI 라벨 한국어 자연스러움
- [ ] (convention) wrapper 패턴, `any` 없음
- [ ] (manual) `pnpm dev` + `uvicorn` 동시 실행 → 브라우저에서 확인

---

## 7. 검증 시나리오 / Verify Scenarios

`hk-verify` skill이 자동으로 채울 체크리스트. 거기 가서 한 줄씩 확인.

---

## 8. Non-goals (의도적으로 안 함)

- (명시)
- (명시)

---

## 9. 노트 / Notes

(작업 중 발견한 것, 다른 slice와 인터페이스, 알려진 한계 등 자유)
