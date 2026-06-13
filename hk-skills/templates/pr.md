# PR: <Title>

> **Title format**: `[<target-module>] <short description>`
> Examples:
> - `[QUEUE] add outbound table component`
> - `[ORCH] add S1 state machine + LLM script`
> - `[TEAM-LOCK] add @tanstack/react-query to package.json`

## Related issue

Closes #<ISSUE-NUM>

## Why / 왜

<!-- 이 PR이 필요한 이유. user story / demo 단계와 연결. -->

## What / 무엇을

- [ ] <change 1>
- [ ] <change 2>
- [ ] <change 3>

## Affected modules / 영향 모듈

<!-- ★ 특히 schema 변경 (API, WS 메시지) 시 모든 사용 모듈 명시. -->

- `<MODULE_A>` — <변경 내용>
- `<MODULE_B>` — <변경 내용 (consumer)>

## Test plan / 검증 방법

<!-- 본인이 직접 한 것 + reviewer가 한 번 더 할 것 -->

- [ ] `ruff check backend/` — 0 errors
- [ ] `pnpm tsc --noEmit` — 0 errors
- [ ] (수동) <UI 페이지에서 row 클릭 → 색상 변화>
- [ ] (수동) <WS 메시지 payload 확인>

## Checklist

- [ ] Issue 본문의 Acceptance criteria 모두 충족
- [ ] 새 dependency 없음 (있다면 issue에 합의된 것)
- [ ] TEAM LOCK 파일 변경 시 모든 팀원 합의
- [ ] schema 변경 시 사용 모듈 owner에게 음성/메신저 합의
- [ ] 모듈 boundary check 통과 (`pre-push`이 자동 검증)
- [ ] 본 PR은 본인이 머지 (자기 모듈) / reviewer가 머지 (다른 모듈)
- [ ] 머지 후 `OWNER.md` 및 issue close

## Reviewer

- [ ] @<reviewer> — please review within 1h (TEAM-LOCK / schema: 30m, urgent: 5m)

## Demo impact (있다면)

- 어떤 demo scenario가 영향을 받는가 (S1, S2, 또는 none)
- 데모 리허설에 영향이 있으면 음성으로 팀에 알림

## Notes / 메모

<!-- reviewer가 알아야 할 context, 알려진 한계, follow-up. -->
