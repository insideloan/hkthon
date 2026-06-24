# 시나리오 (스크립트 모드 재생 데이터)

스크립트 모드(`ORCHESTRATOR_MODE=script`)에서 봇↔고객 대화를 결정론적으로
재생하기 위한 시나리오 JSON. **소유: DATA 모듈**(`hk-skills/MODULES.md`).
로드·검증은 `lambda/orchestrator/models/scenario_loader.py`가 담당한다.

## 등록된 시나리오

| id | 파일 | 제목 | 턴 | 핵심 신호 | 원천 |
|----|------|------|----|-----------|------|
| `s1` | `s1.json` | 대환대출 아웃바운드 (박서준, 차량보유) | 10 | 이탈위험 MOT 3회(`rz-rate/compare/security`) 방어 → 무서류 본 심사 진입 | `consult_redesigned-3.html` const S |
| `s2` | `s2.json` | 보이스피싱 의심 아웃바운드 (급전 요청) | 16 | `fraud_suspected` 사기 감지 → 접수·차단 | `아웃바운드_스크립트_0621.xlsx` 보이스피싱 시트 |

> 등록부는 `scenario_loader.KNOWN_SCENARIOS`와 일치해야 한다. 시나리오를 추가하면
> 이 표 + `KNOWN_SCENARIOS` 둘 다 갱신한다.
>
> 두 시나리오 모두 **아웃바운드 발신**이라 첫 턴은 고객이 먼저 받는 인사
> (`greet: true`, "여보세요?")다. greet 턴은 분석/MOT/사기 파이프라인을 트리거하지
> 않는 가벼운 턴이며, 프론트 `consult-engine`이 이 키로 인사 턴을 식별한다(턴 수 포함).

### 아직 없는 시나리오
시드 고객(`seed.py`)의 `scenario_hint`에는 `S3`(전세자금) 라벨도 있으나, 해당
대화 스크립트 JSON은 **아직 직렬화되지 않았다.** `s3` 로드 시도는
`ScenarioValidationError("unknown scenario 's3'")`로 실패한다.

## 두 가지 위험 신호 — MOT vs fraud_suspected (혼동 주의)

| | MOT (이탈위험) | fraud_suspected (사기) |
|---|---|---|
| 의미 | 고객이 *이탈*하려는 순간 | *금융사기/보이스피싱* 의도 감지 |
| 표현 | 턴의 `mot{marker_id,state,crm_stage}` | 턴의 `fraud_suspected: true` |
| 마커 | `rz-rate/compare/pay/security/avoid` (5종 고정) | (마커 없음, 불리언 플래그) |
| 사용 시나리오 | s1 | s2 |
| 통화 영향 | 없음 (대시보드 표시 전용) | 없음 (대시보드 🟥 표시 전용) |
| 코드 계약 | `models/mot.py` (wire MOT_1~5 매핑) | `agent/nodes.py:detect_fraud` / `fraud_suspected` |

⚠️ 보이스피싱 시나리오에 MOT 마커(`rz-*`)를 쓰지 말 것 — `mot.py`의 wire 매핑은
이탈위험 5종 전용이다. 사기는 `fraud_suspected` 플래그로만 표현한다.

## JSON 스키마 (요약)

최상위: `scenario_id`, `title`, `description`, `customer_id`, `turns[]`,
그리고 선택 `expected_turns`(턴 수가 18이 아니면 **필수 선언**). 각 턴:

- 필수: `seq`(0..n), `speaker`(`bot`|`customer`|`agent`),
  `node`(`IDENTIFY`|`CONSENT`|`PROPOSE`|`CHANNEL`|`CLOSING` — AGENT `Stage` enum.
  AGENT가 마지막 봇 Turn의 node에서 stage를 역추론하므로 정합 필수), `text`,
  `tokens[]`, `churn_after`(0-100), `flag`(`risk`|`def`|`null`)
- `tokens[]`: `{text, polarity(PRO|CONS|null), reason}` — polarity는 색상용이
  아니라 턴 `flag` 배지 분기 신호(SSOT-3)
- 선택: `greet`(bool, 인사 턴), `fraud_suspected`(bool),
  `mot{marker_id,state,crm_stage}`,
  `compliance{draft,violated_policies[],final,state}`,
  `strategy_headline`+`strategy_lead`(쌍)

검증 규칙은 `scenario_loader.validate_scenario`가 SSOT. 고객 턴 연속 금지(교대),
seq 순서, enum 값을 모두 강제한다.

## Mock 재생 vs AGENT 소비 — 경로 분리 (중요)

| | Mock(데모) 재생 | AGENT live 소비 |
|---|---|---|
| 대상 시나리오 | **s1만** (박서준 대환) | s2(보이스피싱 이상탐지) 등 |
| 진입점 | `load_mock_scenario(id)` | `load_scenario(id)` |
| 화이트리스트 | `MOCK_SCENARIOS=("s1",)` 강제 | 없음 (`KNOWN_SCENARIOS` 전체) |
| 위반 시 | `MockScenarioError` | — |

⚠️ **s2는 mock 시나리오가 아니다.** s2는 LangGraph AGENT 이상탐지
(`detect_fraud`)를 만들기 위한 시나리오이며, 부스 데모에서는 참석자가 실시간
STT로 연기하는 live 경로로만 처리한다. mock/스크립트 재생 경로는 박서준 s1
하나만 소비해야 한다. 따라서 **mock 재생 글루는 `scenario_hint`로 ID를 고르지
말고 `load_mock_scenario`를 거쳐 화이트리스트를 강제**한다.

## 로드 계약 — 다른 모듈은 이렇게 호출한다

시나리오 선택·로드·검증은 **반드시 `scenario_loader`를 경유**한다. 호출 측
(AGENT 재생 로직 / BACKEND 핸들러 글루)에서 파일 경로나 S3 키를 직접 만들지
말 것 — ID만 넘긴다.

```python
from orchestrator.models import scenario_loader as sl
from orchestrator.api.config import get_settings

settings = get_settings()

# --- Mock(데모) 재생: 박서준 s1만 허용 ---
# scenario_hint로 ID를 고르지 않는다 — mock은 항상 s1.
# load_mock_scenario가 MOCK_SCENARIOS 화이트리스트를 강제한다.
mock = sl.load_mock_scenario("s1", bucket=settings.assets_bucket)
# s2를 넘기면 MockScenarioError로 막힘:
#   sl.load_mock_scenario("s2")  # -> MockScenarioError

# --- AGENT live 소비: scenario_hint 기반 선택 가능(s2 포함) ---
# 고객의 scenario_hint(대문자 S1/S2) → 로더 id(소문자 s1/s2)
scenario_id = (customer.scenario_hint or "S1").lower()
data = sl.load_scenario(scenario_id, bucket=settings.assets_bucket)

# 로컬/테스트: bucket 생략 시 번들된 data/scenarios/{id}.json 에서
data = sl.load_scenario(scenario_id)

for turn in data["turns"]:
    ...  # seq 순서대로 재생
```

호출 규약:
- **mock/데모 재생은 `load_mock_scenario`** — `MOCK_SCENARIOS`(s1) 밖 ID는
  `MockScenarioError`. `scenario_hint`로 mock ID를 고르지 말 것.
- **AGENT live 소비는 `load_scenario`** — `KNOWN_SCENARIOS` 전체 허용.
- **ID는 소문자** (`s1`, `s2`). `scenario_hint`는 대문자이므로 `.lower()` 필요.
- `bucket` 지정 시 S3 `scenarios/{id}.json`, 생략 시 번들 로컬에서 로드.
- 로드 후 파일의 `scenario_id`가 요청 ID와 다르면 `ScenarioValidationError`.
- 미등록 ID(예: `s3`)는 `ScenarioValidationError("unknown scenario …")`.
- S3 키가 필요하면 직접 조립하지 말고 `sl.s3_key_for(id)` 사용.

### 연결 현황 (2026-06-23)
`scenario_loader`는 완성·검증됐으나 **아직 어떤 재생 경로에도 호출되지 않는다.**
스크립트 모드 재생(`resolvers/calls.py`=BACKEND, `agent/context.py`=AGENT)이 위
계약대로 `load_scenario`를 호출하도록 연결하는 것은 해당 모듈 오너의 후속 작업이다.
