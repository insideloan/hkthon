# Verify Checklist — `CLOUD-007` (#49)

> AppSync(GraphQL) API + 스키마 + resolver — **placeholder 수준** connect/verify.
> 실제 계약은 BACKEND `graphql/schema.graphql`이 교체.

## A. 자동 검증

- [x] `cdk synth` 0 error, `cdk deploy` UPDATE_COMPLETE
- [x] AppSync에 placeholder 스키마(createCall/nextTurn/onTurn) 배포됨
- [x] orchestrator Lambda 데이터소스 + Mutation resolver 2개 배선

## B. 수용 기준 (#49)

- [~] 배포 스키마가 `graphql/schema.graphql`과 일치 — **placeholder 부분집합** 사용 (BACKEND 실스키마는 #49 실작업에서 교체). introspection: `mutations=[createCall, nextTurn]`, `subscriptions=[onTurn]`
- [x] `createCall` 뮤테이션 200 + DynamoDB row 생성 → `{callId, state:CREATED}` + `CALL#…/META` 확인
- [~] 구독 클라이언트가 Streams 팬아웃 메시지 수신 — placeholder는 `@aws_subscribe(nextTurn)` mutation-linked 구독으로 배선(Streams 팬아웃은 실계약/#28에서). `onTurn` 필드 배포 확인

## C. 범위 메모

- infra-owned placeholder 스키마(`infra/lib/schema.placeholder.graphql`). BACKEND `graphql/`는 미변경.
- 실제 8개 뮤테이션/구독 전체 계약은 BACKEND PR로 이 자리를 교체.

## 결과

- [x] **PASS** (placeholder 수준) — AppSync→Lambda→DynamoDB 경로 실증.
