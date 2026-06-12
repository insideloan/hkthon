---
name: hk-backlog
description: PRODUCT-BRIEF의 시나리오를 실제 Feature backlog로 변환. 우선순위와 rough estimate 포함. hk-onboard 후 1회 실행.
---

# hk-backlog — Feature Backlog 빌드 / Build Feature Backlog

> **목적 / Purpose**: PRODUCT-BRIEF의 "3가지 시나리오"를 **데모 가능한 feature**들로 분해하고 우선순위를 매김. 1회 실행.
> Decompose the 3 PRODUCT-BRIEF scenarios into demoable features with priority. Run once.

---

## 1. 언제 쓰나 / When to use

- `hk-onboard` 직후, 팀 전체, 1회.
- 약 30-60분.

**트리거**:
- "백로그 만들자" / "feature list 정리"
- "what to build first" / "우선순위"

---

## 2. 입력 / Input

- `reference/PRODUCT-BRIEF.md` (필수)
- `reference/ARCHITECTURE.md` (선택, 기능별 rough 위치 매핑에 사용)

없으면 `hk-vision`부터.

---

## 3. 진행 / Process

### 3.1 사용자(팀)와 대화

다음 3가지를 사용자에게 한국어로 확인:

1. **"데모의 happy path는? S1 → S2 → S3 순서로 보여줄까요, 아니면 S1만 깊게?"**
2. **"각 시나리오에서 'must-have'와 'nice-to-have'는?"**
3. **"4-5명 중 누가 backend/frontend 어느 쪽에 강한지?"** (이건 rough 분배용)

답변을 받으면, Claude가 다음 작업을 **사용자 앞에서** 수행:

### 3.2 Feature 후보 작성

PRODUCT-BRIEF의 §3 (3 시나리오) + §4 (화면 구성)을 따라 **8-15개 feature**를 도출.

각 feature 형식:

```yaml
- id: F01
  title: <한 줄>
  scenario: S1 | S2 | S3 | cross (전체 데모 셋업)
  type: backend | frontend | both | infra
  priority: P0 (must, 없으면 데모 불가) | P1 (should) | P2 (nice)
  estimate_h: 1-2
  notes: <있으면>
```

### 3.3 우선순위 가이드 (제안, 팀과 합의)

| 시나리오 | P0 | P1 | P2 |
|---|---|---|---|
| S1 (가입) — main happy path | F01..F05 | F12 | — |
| S2 (분노) | F06, F07 | — | — |
| S3 (사기) | F08 | — | — |
| Cross (UI 공통) | F09, F10, F11 | — | — |
| Polish | — | F13, F14 | F15 |

**P0만 = "minimal demo"** (필수)
**P0 + P1 = "good demo"** (목표)
**P0 + P1 + P2 = "polished demo"** (여유 있으면)

### 3.4 산출물: `BACKLOG.md`

`~/workspace/hackathon-2026/BACKLOG.md`에 작성:

```markdown
# Backlog — AI Outbound Call Bot

> hk-backlog에서 생성, <날짜>.
> P0 = must, P1 = should, P2 = nice.

## P0 — Minimal Demo

| ID | Title | Scenario | Type | Owner (TBD) | h |
|---|---|---|---|---|---|
| F01 | ... | ... | ... | ... | 1.5 |
| ... | ... | ... | ... | ... | ... |

## P1 — Good Demo
| ... |

## P2 — Polish
| ... |

## Demo Plan

1. <30초>: F09 (queue 화면) 보여주기
2. <30초>: F01..F05 (S1 happy path) 풀 플로우
3. <30초>: F06 (S2) + F08 (S3) 압축 데모
4. <30초>: F13 (memo popup, polish)
```

### 3.5 합의

사용자에게 마지막 확인:

```
"이 BACKLOG.md로 갈까요? OK면 다음 단계는 hk-slice 입니다.
P0만 = 약 12-15시간, P0+P1 = 약 18-20시간, 모두 = 약 22-24시간.
24시간 안에 끝낼 범위는 어디까지?"
```

YES 받기 전엔 다음 스킬 안 감.

---

## 4. 출력 / Output

- **`BACKLOG.md`** (P0/P1/P2 + Demo Plan)
- 짧은 한국어 요약:

```
✅ Backlog locked
- P0: N개 (예: 8개, minimal demo)
- P1: M개 (good demo, 시간 남으면)
- P2: K개 (polish)
- Owner: 미정 (hk-slice에서 결정)
- Demo Plan: 위 BACKLOG.md §Demo Plan

다음: /hk-slice (P0 feature들을 slice로 분해)
```

---

## 5. 가드레일 / Guardrails

- ❌ **P0가 12개 초과하지 않게.** 24h에 불가능.
- ❌ **architecture/우회**: 새 컴포넌트 만들지 않기. 기존 ARCHITECTURE §5의 위치 사용.
- ❌ **의존성 추가 제안 금지.** STACK에 있는 것만.
- ✅ **사용자 앞에서 BACKLOG.md를 작성** — 사용자가 한 줄 한 줄 보면서 결정할 수 있게.
- ✅ **Demo Plan이 시간 배분 명확히** — 4분 안에 끝나야 함.
- ✅ **OUT OF SCOPE 3-5개** PRODUCT-BRIEF §6에 명시 안 됐으면 여기서 보강.

---

## 6. 다음 단계로 / Hand-off

**조건**: BACKLOG.md의 P0가 모두 채워졌고, 사용자가 "OK" 했을 때.

**다음**: `/hk-slice` (P0 feature를 slice로 분해 + owner 배정).
