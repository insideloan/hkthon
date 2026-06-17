---
name: hk-vision
description: 해커톤 시작 시 제품 비전을 명확히 lock-in. PRODUCT-BRIEF.md를 생성/갱신. Use when team needs to align on what we are building before any code is written.
---

# hk-vision — Product Vision Lock-In / 제품 비전 락인

> **목적 / Purpose**: 해커톤 시작 후 30분 안에 **무엇을 만드는지**를 모두가 같은 문장으로 말할 수 있게 합니다. 코드는 한 줄도 안 침.
> Align the whole team on "what we are building" in 30 minutes. No code yet.

---

## 1. 언제 쓰나 / When to use

- 해커톤 시작 직후, 1회.
- 또는 product 방향이 흔들릴 때 재실행 (단, 해커톤 중엔 1회로 한정 권장).

**트리거 / Trigger phrases**:
- "해커톤 시작하자" / "제품 정의하자"
- "vision lock-in" / "product brief 다시 정리"

---

## 2. 입력 / Input

없음 (대화형). 사용자에게 **한국어로** 질문하여 정보를 모음.

만약 `~/.claude/reference/PRODUCT-BRIEF.md`가 이미 있으면 읽어서 갱신할지 확인.

---

## 3. 진행 / Process

### 3.1 사용자(팀)에게 묻는 5개 질문

절대 한꺼번에 묻지 말고, **한 번에 하나씩**. 답변을 받으면 다음 질문. 답변이 모호하면 **그 자리에서** 명확히.

1. **"한 문장으로, 이게 뭔가요? 심사위원이 10초 안에 기억할 한 문장."**
2. **"사용자는 누구인가요? 1차 사용자와 그 사용자가 의사결정을 끝낸 후 영향받는 사람은?"**
3. **"핵심 시나리오는? (이 시스템이 데모에서 보여줄 S1 흐름)"**
4. **"데모 환경은? 노트북 로컬? 클라우드 배포?"**
5. **"이번 24시간에 명시적으로 안 할 것은? (out of scope 3-5개)"**

> 이미 `reference/PRODUCT-BRIEF.md`에 답이 있으면 **그대로 읽고 확인만** 받고 진행.

### 3.2 산출물: `reference/PRODUCT-BRIEF.md` 갱신

다음 섹션이 모두 채워졌는지 확인 (없으면 추가):

- 1. 한 문장 요약
- 2. 사용자
- 3. 핵심 시나리오 (S1)
- 4. 화면 구성 (Agent UI, Customer UI, Mic toggle)
- 5. 비기능 요구사항
- 6. Out of Scope
- 7. 성공 기준

### 3.3 Lock-in 선언

사용자에게 마지막 확인:

```
"이 PRODUCT-BRIEF.md로 갈까요? OK면 다음 단계는 hk-onboard 입니다."
```

YES 답변 받기 전엔 다음 단계로 안 감.

---

## 4. 출력 / Output

- **갱신된 `reference/PRODUCT-BRIEF.md`**
- 짧은 한국어 요약 (사용자에게 보여줄 것):

```
✅ Vision locked
- 제품: AI Outbound 금융상품 Sales Call Bot
- 데모 시나리오 1개: S1=한도조회 요청→상담원 연결
- 사용자: 관리자 + (가짜) 고객
- 환경: 로컬 노트북, 1세트
- 24h 안에 안 함: 실전화 연동, 인증, 영문, 멀티유저

다음 단계: 각자 /hk-onboard
```

---

## 5. 가드레일 / Guardrails

- ❌ **코드/architecture/stack은 여기서 다루지 않음.** 그건 `hk-onboard`과 `reference/ARCHITECTURE.md`의 영역.
- ❌ **5개 질문보다 많이 묻지 않기.** 해커톤 시간 압박.
- ❌ **사용자 답을 추측해서 채우지 않기.** 모호하면 한 번 더.
- ✅ **명시적 lock-in 받기.** YES 없이는 다음 스킬 안 시작.
- ✅ **한국어로 질문, 한국어로 요약.** 코드/identifier만 영어.

---

## 6. 다음 단계로 / Hand-off

**조건**: PRODUCT-BRIEF.md에 1-5섹션 모두 있고, 사용자가 "OK" 했을 때.

**다음**: `/hk-onboard` (각자 한 번씩).
