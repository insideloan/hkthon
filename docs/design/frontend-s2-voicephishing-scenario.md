# 설계: 프론트엔드에 S2(보이스피싱) 시나리오 추가

> 상태: **설계안 (구현 전)** · 작성 2026-06-23 · 대상 모듈: **FRONTEND**(주실 소유)
> 배경: 시연부스 롤카드 ①번(보이스피싱)이 데모의 핵심 "wow" 카드인데, 현재 프론트
> 상담 엔진에는 S1(대환)만 있고 보이스피싱 시나리오가 없다. 백엔드에는
> `data/scenarios/s2.json`이 있으나 프론트는 이를 읽지 않고 자체 TS 시나리오
> (`consult-engine`)로 재생한다(별개 SSOT).

## 1. 현재 구조 (왜 단순 추가가 안 되나)

프론트 상담 데모(`/calls/[id]`)는 `useConsultEngine`이 구동하며, 시나리오 1벌이
**6개 모듈의 병렬 데이터**로 구성된다. 모두 `@/consult-engine/...`에서 하드 import:

| 파일 | export | 단위 | 비고 |
|------|--------|------|------|
| `data/scenario.ts` | `S`, `JOURNEY`, `STEP_OF`, `ORDER` | 턴(19) / 단계(8) | 대화·여정맵 |
| `data/uanalyze.ts` | `UANALYZE` | custSeq(8) | 카드① 발화분석 구슬 |
| `data/dbdata.ts` | `DBDATA`, `DIAG` | custSeq(8) | 카드② DB조회·도식 |
| `data/comply.ts` | `COMPLY`, `COMPLIANCE` | custSeq(9) | 카드③ 컴플라이언스 |
| `data/strategy.ts` | `STRAT20`, `DIM`, ... | 전역 카탈로그 | 시나리오 무관(공유) |

**정렬 규약(핵심):** 고객 발화가 나올 때마다 엔진이 `custSeqRef`를 +1 하고,
`uaFor(custSeq)`/`dbFor`/`cmpFor`/`procFor`가 그 인덱스로 위 배열을 읽는다
(`utils.ts`). 즉 **S의 N번째 고객 발화 ↔ UANALYZE[N] ↔ DBDATA[N] ↔ COMPLY[N]**
가 1:1로 맞아야 한다. 어긋나면 엉뚱한 분석 카드가 뜬다.

**문제점 2가지:**
1. **시나리오 선택 분기가 없다.** `useConsultEngine`이 `S`/`STEP_OF`를 정적
   import한다(`useConsultEngine.ts:12`). callId·고객이 무엇이든 항상 S1 재생.
2. `/calls/[id]/page.tsx`는 `callId`만 알 뿐, 어떤 고객·시나리오인지 모른다.

## 2. 설계안

### 2.1 시나리오 묶음(bundle) 추상화
6개 export를 시나리오별 1개 객체로 묶는다. **기존 S1 데이터는 이동만 하고 내용
불변**(회귀 0 목표).

```ts
// consult-engine/data/scenarios/index.ts (신규)
export interface ScenarioBundle {
  id: 's1' | 's2';
  S: ScenarioEntry[];
  JOURNEY: JourneyStep[];
  STEP_OF: number[];
  ORDER: readonly string[];
  UANALYZE: UAnalyzeEntry[];
  DBDATA: DbDataEntry[];
  DIAG: DiagEntry[];
  COMPLY: ComplyEntry[];
}
export const SCENARIOS: Record<string, ScenarioBundle> = { s1, s2 };
export const DEFAULT_SCENARIO = 's1';
```

- `strategy.ts`(STRAT20/DIM/COMPLIANCE 규제정의)는 시나리오 공통이므로 묶지 않음.
- 기존 `data/scenario.ts` 등은 `data/scenarios/s1/*`로 재배치하거나, 최소 변경으로
  현 파일을 s1 번들로 감싸고 s2만 신규 추가(아래 2.4 참조).

### 2.2 엔진 파라미터화
`useConsultEngine`이 번들을 인자로 받게 한다. `S`/`STEP_OF` 직접 import 제거,
`uaFor` 등 헬퍼도 번들을 받도록 시그니처 변경(또는 클로저 주입).

```ts
const engine = useConsultEngine({ chatRef, mapRef, cardEmoRef, callId, scenario });
```

### 2.3 시나리오 선택 (callId/고객 → 시나리오 id)
- **데모 단순안(권장):** URL 쿼리 `?scenario=s2` 또는 경로 컨벤션으로 선택.
  `page.tsx`에서 읽어 번들 주입. 백엔드 의존 없음 → 부스에서 즉시 전환 가능.
- (대안) 고객의 `scenario_hint`를 백엔드에서 받아 매핑 — 백엔드 연동 필요, 데모엔 과함.

### 2.4 S2 데이터 작성 (보이스피싱 15턴)
`data/scenarios/s2.json`(백엔드)을 원천으로 TS 번들 생성. 단, **프론트 형식으로
재매핑** 필요(단순 복사 아님):

- `s2.json` turn → `ScenarioEntry`: `text→txt`, `speaker(bot/customer)→who(ai/cust)`,
  `tokens[].polarity(CONS/PRO)→kw[].{r/g}`, `strategy_*→bann/nx`.
- **MOT 부재 처리:** s2는 이탈위험(rz-*)이 아니라 `fraud_suspected`. 여정맵
  위험노드(`risk.rz`)는 비우거나, **사기 감지 전용 표시**를 새로 정의해야 함
  (JourneyMap이 rz-* 5종만 알므로 신규 상태 추가 검토 — FRONTEND 결정사항).
- custSeq 정렬: s2 고객 발화 수(7개)에 맞춰 UANALYZE/DBDATA/DIAG/COMPLY 각각
  동수로 작성.

### 2.5 사기 감지 시각화 (신규 — 가장 큰 미정 항목)
S1의 "이탈위험 게이지 출렁"에 해당하는 S2의 wow 포인트는 **🟥 금융사기 의심
점등**이다(롤카드 ①). 현재 컴포넌트에 이 표시가 있는지 FRONTEND 확인 필요:
- 관리자 큐의 `fraud_suspected` highlight는 이미 존재(`queue.ts`).
- 상담 화면(JourneyMap/배너)에 사기 표시가 없다면 신규 UI 필요.

## 3. 작업 분해 (구현 시)

1. `ScenarioBundle` 타입 + `SCENARIOS` 레지스트리, 기존 S1을 번들로 래핑 (회귀 0)
2. `useConsultEngine`/`utils` 파라미터화 (S/STEP_OF/헬퍼 번들 주입)
3. `page.tsx` 시나리오 선택(쿼리스트링) + 번들 주입
4. S2 번들 데이터 6종 작성 (scenario/uanalyze/dbdata/diag/comply)
5. 사기 감지 시각화 (배너/맵 신규 상태) — 2.5
6. 테스트: S1 회귀(기존 동작 불변) + S2 재생 스모크

## 4. 모듈 경계 / 리스크

- **전부 `frontend/src/**` = FRONTEND(주실) 소유.** DATA(본 작성자)가 직접 구현 시
  경계 위반 → 반드시 FRONTEND 오너 리뷰/합의 후 진행.
- 최대 리스크: **2.5 사기 시각화**가 컴포넌트 신규 작업이라 분량·디자인 불확정.
- 회귀 리스크: S1 데이터 이동 시 custSeq 정렬 깨지면 카드 오표시 → 이동은
  "내용 불변, 위치만" 원칙 + S1 스모크로 방어.

## 5. 권장 진행 순서

설계 합의(이 문서) → FRONTEND 오너가 1~3(구조) 선반영 → S2 데이터(4) →
사기 시각화(5). 1벌만 있을 때 구조부터 바꾸면 회귀 위험이 크므로 **S1 무회귀를
먼저 못박고** S2를 얹는다.
