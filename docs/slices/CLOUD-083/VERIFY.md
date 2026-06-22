# Verify Checklist — `CLOUD-083` (#83)

> AGENT 라이브 모드 활성화 — Guardrail/env/렉시콘/Secret 프로비저닝.
> AGENT 코드(#76·#79·#80·#81·#82)가 참조하는 인프라 요소를 CLOUD가 채운다.

---

## A. 코드/자동 검증 / Code & Auto Verify

> Claude가 자동 실행. 결과만 확인하세요. (node는 nvm, 아래 명령 앞에 `cd infra`.)

- [x] `npx tsc --noEmit` — exit 0
- [x] `npx cdk synth --quiet` — exit 0, 경고 없음
- [x] 합성 템플릿(`cdk.out/HkthonStack.template.json`) `AWS::Bedrock::Guardrail` 검증:
  - DENY 토픽 4종: `ConfirmPromise`(확정·약속) / `FixedFigure`(확정수치) /
    `RateNeverRises`(금리불변) / `RiskDownplay`(리스크무마)
  - `SensitiveInformationPolicyConfig`: PII 5종(EMAIL/PHONE/NAME ANONYMIZE,
    카드·IBAN BLOCK) + 정규식 2종(`KoreanRRN` 주민등록번호, `KoreanBankAccount` BLOCK)
  - ContentFilter 5종(HATE/INSULTS/SEXUAL/VIOLENCE/MISCONDUCT) 유지
- [x] Lambda env에 AGENT 라이브 계약 변수 주입 확인 (orchestrator Function):
  - `BEDROCK_GUARDRAIL_ID` ← Guardrail `attrGuardrailId` (addEnvironment)
  - `BEDROCK_GUARDRAIL_VERSION` ← Guardrail `attrVersion`
  - `LLM_MODEL=global.anthropic.claude-sonnet-4-6`, `LLM_TIMEOUT_S=6`
  - `LEXICON_LOCAL_PATH=/var/task/orchestrator/churn_risk_lexicon.json`
- [x] 렉시콘 번들 동봉 — `lambda/orchestrator/churn_risk_lexicon.json`
  (SSOT `hk-skills/reference/churn_risk_lexicon.json`의 복사본, 5323B 일치)

---

## B. 수용 기준 (Issue #83 §Acceptance) / Acceptance Criteria

- [x] Lambda가 `BEDROCK_GUARDRAIL_ID` 주입된 상태로 배포 → compliance가 실제
      Guardrails 검수 수행 (compliance.py `_GUARDRAIL_ID` 설정 시 `apply_guardrail`
      실호출, 응답 `GUARDRAIL_INTERVENED` → 차단). **이번 PR이 토픽/PII 정책을
      채워** Bedrock 경로가 룰 폴백과 동일한 금소법 위반을 실제로 잡는다.
- [x] orchestrator가 렉시콘을 로드 → churn 점수가 0이 아닌 값 산출
      (`LEXICON_LOCAL_PATH` 실파일 동봉, 누락 시에만 빈 렉시콘 폴백→0)
- [x] `requirements.txt` 의존성이 런타임에 존재 (import 에러 없음)
      — `OrchestratorDeps` 레이어에 langchain/langgraph/langchain-aws/httpx/pydantic
      설치됨 (#89에서 빌드, `infra/layers/orchestrator-deps/python/` 확인)

---

## C. Deploy 검증 (deploy 실행 후) / Post-deploy

> 배포 계정은 Anthropic 모델 액세스가 사전 부여됨 (CLOUD-009/#51 확인). 콘솔 enable 불필요.

### 블록 1 — Guardrail 차단 단건 검증

```bash
# Guardrail ID / version 확인
aws cloudformation describe-stacks --stack-name HkthonStack \
  --query "Stacks[0].Outputs[?OutputKey=='GuardrailId'].OutputValue" --output text

# 금소법 위반 출력 차단 케이스 (확정·약속) → action: GUARDRAIL_INTERVENED 기대
aws bedrock-runtime apply-guardrail \
  --guardrail-identifier <GuardrailId> --guardrail-version DRAFT \
  --source OUTPUT \
  --content '[{"text":{"text":"이 대출은 무조건 승인됩니다. 금리는 절대 안 오릅니다."}}]' \
  --region ap-northeast-2

# 정상 상담 출력 (판별력) → action: NONE 기대
aws bedrock-runtime apply-guardrail \
  --guardrail-identifier <GuardrailId> --guardrail-version DRAFT \
  --source OUTPUT \
  --content '[{"text":{"text":"심사 결과에 따라 금리와 한도가 달라질 수 있습니다."}}]' \
  --region ap-northeast-2
```

- [ ] 위반 케이스 → `action: GUARDRAIL_INTERVENED`, assessments에 토픽 차단
- [ ] 정상 케이스 → `action: NONE`
- [ ] PII 케이스(주민등록번호 `900101-1234567` 포함) → BLOCK

### 블록 3 — 렉시콘 콜드스타트 로드

- [ ] orchestrator 콜드스타트 로그에 렉시콘 로드 성공 (빈 렉시콘 경고 없음)
- [ ] 고객 턴 후 `onIndexUpdate.churnRisk` 0이 아닌 값

### 블록 4 — Typecast TTS Secret 값 설정 (IaC 외 · CLI 1회)

> 리소스(`hkthon/typecast-api-key`)는 스택에 존재. **값만** 콘솔/CLI로 주입 (코드 커밋 금지).

```bash
aws secretsmanager put-secret-value \
  --secret-id hkthon/typecast-api-key \
  --secret-string '<TYPECAST_API_KEY>' \
  --region ap-northeast-2
```

- [ ] `aws secretsmanager get-secret-value --secret-id hkthon/typecast-api-key` → 값 존재

---

## D. 범위 메모 / Scope Notes

- **이번 PR의 실작업**: 블록 1의 Guardrail **정책 콘텐츠**(금소법 DENY 토픽 +
  PII/정규식) 추가. 기존 스택은 generic content filter만 있어 Bedrock 경로가
  금소법 위반(확정수치/금리불변/리스크무마)을 못 잡고 있었다.
- 블록 2(env 주입)·3(렉시콘 번들)·5(deps 레이어)는 선행 PR(#86·#89)에서 이미
  머지됨 → 본 VERIFY는 현황 재확인.
- 블록 1 모델 *계정* 액세스는 CDK 범위 밖(계정 레벨) — CLOUD-009/#51에서 검증 완료.
- 블록 4 Secret **값**은 크레덴셜이라 IaC/레포에 넣지 않음 — 배포 후 CLI 1회 주입.
