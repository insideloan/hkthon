## Why / 왜 필요한가

<!-- 1-2문장. 이 task가 왜 필요한지. 어떤 user story / 어떤 demo 단계와 연결되는지. -->

## What / 무엇을

<!-- 체크박스로. 끝나면 [x] -->

- [ ] <step 1>
- [ ] <step 2>
- [ ] <step 3>

## Affected modules / 영향 모듈

<!-- 본인이 owner인 모듈 외에 영향을 주는 모듈이 있으면 명시. 예: schema 변경 -->

- `<MODULE_NAME>` — <어떻게 영향? 또는 "없음">

## Acceptance / 완료 기준

<!-- 측정 가능한 기준. hk-verify의 VERIFY.md §B에 그대로 복사됨. -->

- [ ] <측정 가능 1 (예: API endpoint 200, 페이지에 row 3개 표시)>
- [ ] <측정 가능 2>
- [ ] <측정 가능 3>

## Module / 모듈

<!-- QUEUE | PHONE | CALL | SUMMARY | ORCH | INFRA 중 하나 -->

`<MODULE>`

## Estimate / 예상 시간

`Nh`

## Dependencies / 의존성 (있다면)

<!-- 다른 issue가 끝나야 시작 가능하면 명시. 예: blocked by #QUEUE-001 -->

- blocked by: <#ISSUE-NUM or none>
- blocks: <#ISSUE-NUM or none>

## Files I expect to change / 변경 예정 파일

<!-- optional이지만 권장. PR 올릴 때 diff와 비교 가능. -->

- `path/to/file1.tsx`
- `path/to/file2.py`

## Shared files I might need to touch / 다른 모듈 파일 (PR 필요)

<!-- optional. PR로 처리 -->

- none, or:
- `backend/app/api/calls.py` — ORCH PR 필요, reason: ...

---

<!-- 이 issue가 끝나면 hk-verify의 VERIFY.md가 자동 생성됩니다. -->
