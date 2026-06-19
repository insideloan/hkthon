---
name: hk-onboard
description: 개발 환경 세팅, stack 검증, Tailwind template 흡수. 각 팀원이 1회 실행. 첫 implementation 전에 반드시 완료.
---

# hk-onboard — 환경 온보딩 / Environment Onboarding

> **목적 / Purpose**: 본인 노트북에 dev 환경 세팅 + 우리 stack/architecture 검증 + (선택) Tailwind template 흡수. **이게 끝나야 hk-implement 가능.**
> Set up dev environment, verify stack/architecture, optionally absorb a Tailwind template. Required before hk-implement.

---

## 1. 언제 쓰나 / When to use

- `hk-vision` 직후, **각자 1회** (팀원 5명이 각자 실행).
- 또는 본인 환경이 깨졌을 때 재실행.

**트리거 / Trigger phrases**:
- "환경 세팅하자" / "내 노트북 세팅"
- "onboard" / "셋업"

---

## 2. 입력 / Input

- `reference/PRODUCT-BRIEF.md` (있어야 — 없으면 hk-vision부터)
- (선택) 팀이 정한 Tailwind template의 GitHub URL
- 환경: macOS 또는 Linux, Python 3.13+, Node 20+, AWS CDK CLI, AWS 자격증명

> **중요**: 사용자가 template URL을 안 줬으면, `hk-onboard`은 template 없이도 끝낼 수 있어야 함. 그 경우 `src/components/ui/*` wrapper는 일단 **placeholder(Tailwind 클래스 직접 사용한 임시 컴포넌트)** 로 시작. 나중에 template URL 생기면 이 skill을 다시 실행.

---

## 3. 진행 / Process

### 3.1 사전 점검 / Preflight

각 항목이 PASS인지 확인. FAIL이면 사용자에게 어떻게 설치하는지 안내.

```bash
# 1. Claude Code 설치 확인
claude --version     # OK면 진행. 없으면 https://docs.claude.com/claude-code 안내

# 2. Python
python3 --version    # 3.13+

# 3. Node / pnpm
node --version       # 20+
pnpm --version       # 없으면: npm install -g pnpm

# 4. AWS CDK CLI
cdk --version        # 없으면: npm install -g aws-cdk

# 5. AWS 자격증명
aws sts get-caller-identity   # 없으면: aws configure 또는 환경변수 AWS_ACCESS_KEY_ID/SECRET

# 6. (선택) uv
uv --version         # 없으면: brew install uv 또는 pip install uv
```

**모두 PASS일 때만 다음 단계로.**

### 3.2 프로젝트 디렉토리 생성 / Create project dir

```bash
mkdir -p ~/workspace/hackathon-2026
cd ~/workspace/hackathon-2026
```

이 디렉토리에서:
- `lambda/orchestrator/` (Python 오케스트레이터: `agent/`, `llm/`, `stt/`, `tts/`, `models/`, `api/`, `resolvers/`, `handler.py`, `requirements.txt`)
- `graphql/` (AppSync 스키마)
- `data/` (시나리오 `scenarios/`, 렉시콘 `lexicon/`)
- `infra/` (AWS CDK TypeScript)
- `frontend/` (Next.js)
- `OWNER.md` (slice 분배 후 만들어짐, 지금은 빈 파일)

> **데이터 스토어**: DynamoDB (CDK가 프로비저닝). 로컬 DB 파일 없음. 로컬 개발은 `amazon/dynamodb-local` Docker 컨테이너(경량 옵션) 또는 dev AWS 계정에 직접 배포 중 선택.

### 3.3 Orchestrator(Lambda) 세팅

```bash
# Python 의존성 설치 (requirements.txt SSOT)
cd lambda/orchestrator
pip install -r requirements.txt
# 의존성: boto3 langchain langgraph langchain-aws amazon-transcribe httpx pydantic
# boto3: Bedrock + Transcribe STT 공통; LLM은 langchain-aws(ChatBedrockConverse)
# Typecast TTS는 REST이므로 httpx로 호출 (별도 SDK 없음)
```

`MODULES.md` §2에 따라 `handler.py`, `agent/`, `llm/`, `stt/`, `tts/`, `models/`, `api/`, `resolvers/` **빈 stub** 생성. 내용은 `hk-implement`에서 채움.

**이탈위험도 사전 데이터 복사 (AGENT 모듈 — `data/lexicon/`)**:
`analysis.churn_risk`(이탈위험도) 점수 계산은 AGENT의 agent 턴 파이프라인이 키워드 사전을 로드합니다 (`reference/CHURN-RISK-LEXICON.md` SSOT). `lambda/orchestrator/agent/*`는 AGENT 소유 (`docs/MODULES.md` §2).
코드가 런타임에 읽을 수 있게 machine-readable 사전을 `data/lexicon/`으로 복사 (CDK가 S3에 업로드, SSOT는 `docs/reference/` 유지):

```bash
# 이탈위험도 키워드 사전 (data/lexicon/ → CDK가 S3 업로드)
mkdir -p data/lexicon
cp ~/.claude/reference/churn_risk_lexicon.json data/lexicon/churn_risk_lexicon.json
```

> 사전 자체(키워드/가중치) 변경은 `docs/reference/`의 두 파일(`CHURN-RISK-LEXICON.md` + `churn_risk_lexicon.json`)을 동시에 고쳐 PR로 반영하고, 위 복사를 다시 수행 (`reference/CHURN-RISK-LEXICON.md` §6).

**CDK infra 검증**:
```bash
cd infra
npm install
cdk synth
# CloudFormation 템플릿이 출력되면 PASS (실제 배포 불필요)
```

**Orchestrator 유닛 테스트**:
```bash
cd lambda/orchestrator
pytest tests/
# 전체 PASS여야 진행
```

### 3.4 Frontend 세팅

```bash
cd ~/workspace/hackathon-2026
pnpm create next-app@latest frontend \
  --typescript --tailwind --app --src-dir \
  --import-alias "@/*" --no-eslint --use-pnpm
cd frontend
# STACK.md §3의 추가 의존성
pnpm add @xyflow/react lucide-react zustand zod clsx
# .env.example 생성
cat > .env.example << 'EOF'
# AppSync GraphQL 엔드포인트 (CDK 배포 후 확인)
NEXT_PUBLIC_APPSYNC_URL=<appsync-graphql-endpoint>
NEXT_PUBLIC_APPSYNC_API_KEY=<key>
# 백엔드 시크릿(TYPECAST_API_KEY 등)은 Secrets Manager / AWS 표준 체인으로 관리 — 커밋 금지
EOF
```

그리고 STACK.md §3의 디렉토리 구조대로 폴더 생성 + stub 파일.

**Frontend 검증**:
```bash
pnpm dev &
# http://localhost:3000 → Next.js 페이지
# 'pnpm tsc --noEmit' → 0 errors
```

### 3.5 Tailwind Template 흡수 (URL이 있는 경우) / Absorb Template

팀이 GitHub URL을 줬을 때만:

1. **URL 클론**:
   ```bash
   cd /tmp
   git clone <template-url> tailwind-template
   cd tailwind-template
   # README 따라 의존성 설치 + 어떤 entry point인지 확인
   ```

2. **컴포넌트 카탈로그 작성**:
   - template의 `src/components/*` 또는 `components/*`를 모두 list
   - 우리 `src/components/ui/*` wrapper와 1:1 매핑:
     ```
     template Button  →  src/components/ui/Button.tsx
     template Card    →  src/components/ui/Card.tsx
     template Modal   →  src/components/ui/Modal.tsx
     ...
     ```
   - 빠진 wrapper는 우리가 placeholder로 작성 (단순 forwardRef + className)

3. **`tailwind.config.ts`의 theme.extend**:
   - template의 색상/폰트 변수를 그대로 옮김
   - 단, **queue 색상** (노란/검정/갈색/초록/빨강)은 `CONVENTIONS.md` §6.2대로 보존

4. **회귀 테스트**:
   ```bash
   pnpm tsc --noEmit
   pnpm dev  # http://localhost:3000 → 기존 placeholder 페이지 잘 뜨는지
   ```

### 3.6 통합 스모크 테스트 / Integration Smoke

순수 로컬(배포 없이) 스모크:

```bash
# 1. infra synth
cd infra && cdk synth
# → CloudFormation 템플릿 출력 (PASS)

# 2. orchestrator 유닛
cd lambda/orchestrator && pytest tests/
# → 전체 PASS

# 3. frontend dev server
cd frontend && pnpm dev
# → http://localhost:3000 OK (PASS)
```

배포된 경우 추가 확인:
```bash
# AppSync GraphQL 엔드포인트 인트로스펙션 또는 queue 쿼리
curl -X POST "$NEXT_PUBLIC_APPSYNC_URL" \
  -H "x-api-key: $NEXT_PUBLIC_APPSYNC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __typename }"}' | jq .
# {"data":{"__typename":"Query"}} 응답이면 PASS
```

안 되는 경우:
- `cdk synth` 실패 → `infra/` CDK 코드 오류 또는 AWS 자격증명 미설정
- `pytest` 실패 → `pip install -r requirements.txt` 재실행
- `pnpm dev` 실패 → `pnpm install` 재실행, `.env.local`의 `NEXT_PUBLIC_APPSYNC_URL` 확인

---

## 4. 출력 / Output

### 4.1 생성된 파일 / Created files

```
~/workspace/hackathon-2026/
├── lambda/orchestrator/  (Python orchestrator stub, deps 설치 완료)
│   ├── agent/  llm/  stt/  tts/  models/  api/  resolvers/
│   ├── handler.py
│   ├── requirements.txt
│   └── tests/
├── graphql/              (AppSync 스키마 stub)
├── data/
│   ├── scenarios/
│   └── lexicon/          (churn_risk_lexicon.json 복사됨)
├── infra/                (CDK TypeScript, cdk synth OK)
├── frontend/             (Next.js stub, wrapper components, 의존성 설치 완료)
└── OWNER.md              (비어있음, hk-slice 후 채워짐)
```

### 4.2 한국어 요약 (사용자에게)

```
✅ Onboard 완료
- infra: cdk synth 성공
- Orchestrator: pytest lambda/orchestrator/tests 통과
- Frontend: http://localhost:3000 OK
- Stack: Next.js(Amplify) + AppSync(GraphQL) + Lambda orchestrator(LangGraph 라이브 모드) + DynamoDB(+Streams) + S3 + Bedrock(Converse+Guardrails) + Transcribe STT + Typecast TTS. 스크립트 모드(기본)/라이브 모드(옵션).
- Template: <사용했으면 URL, 안 했으면 "placeholder wrapper 사용 중">

문서:
- docs/nextjs-aws-architecture.md (아키텍처 SSOT)
- docs/MODULES.md (파일 소유권 SSOT)
- reference/STACK.md (의존성)
- reference/CONVENTIONS.md (규약)
- reference/CHURN-RISK-LEXICON.md (이탈위험도 키워드 사전 — data/lexicon/churn_risk_lexicon.json로 복사 → CDK가 S3 업로드)

다음 단계: 팀 전체가 끝나면 /hk-backlog
```

### 4.3 Git init

```bash
cd ~/workspace/hackathon-2026
git init
git add .
git commit -m "chore: initial scaffold from hk-onboard"
# GitHub repo 만들었다면 push (선택)
```

---

## 5. 가드레일 / Guardrails

- ❌ **새 의존성 추가 금지.** `lambda/orchestrator/requirements.txt`와 `frontend/package.json`에 있는 것만.
- ❌ **Tailwind template이 우리 wrapper 구조를 깨면** template을 거부하고 placeholder 유지. 24h에 template 통합 작업은 위험.
- ❌ **`.env` / `.env.local` 파일 git에 커밋 금지.** `.env.example`만.
- ❌ **인증/DB 마이그레이션/무거운 배포 도구** 설치 금지 (out of scope).
- ❌ **TYPECAST_API_KEY 등 백엔드 시크릿** `.env`에 평문 커밋 금지 — Secrets Manager 또는 AWS 환경변수 체인 사용.
- ✅ **`tsc --noEmit`이 0 error여야 PASS.**
- ✅ **`cdk synth` 성공 + `pytest` 통과 + `pnpm dev` 200이어야 PASS.**
- ✅ **.env.local에 실제 API key 입력 시 git에 안 들어갔는지 확인.**

---

## 6. 트러블슈팅 / Troubleshooting

| 증상 | 원인 | 해결 |
|---|---|---|
| `pnpm dev` → "port 3000 in use" | 다른 process | `lsof -ti:3000 \| xargs kill -9` |
| `pip install` → "ModuleNotFoundError" | 의존성 미설치 | `cd lambda/orchestrator && pip install -r requirements.txt` |
| `cdk synth` → "Unable to resolve AWS account" | AWS 자격증명 미설정 | `aws configure` 또는 `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` 환경변수 설정 |
| `cdk synth` → "Cannot find module 'aws-cdk-lib'" | CDK 의존성 미설치 | `cd infra && npm install` |
| `pytest` → "ModuleNotFoundError" | orchestrator deps 미설치 | `pip install -r requirements.txt` 재실행 |
| Frontend AppSync 연결 실패 | env 미설정 | `.env.local`에 `NEXT_PUBLIC_APPSYNC_URL`, `NEXT_PUBLIC_APPSYNC_API_KEY` 설정 |
| `pnpm tsc` → "Cannot find module '@/...'" | path alias | `tsconfig.json`에 `paths: {"@/*": ["./src/*"]}` |
| Template이 React 18 기반 | 우리 stack 19 | template을 그대로 안 쓰고 wrapper interface만 차용 |
| DynamoDB 로컬 테스트 필요 | dev 계정 없음 | `docker run -p 8000:8000 amazon/dynamodb-local` 로 로컬 DynamoDB 실행 |

---

## 7. 다음 단계로 / Hand-off

**조건**:
- [ ] `cdk synth` 성공 (infra)
- [ ] `pytest lambda/orchestrator/tests` 통과 (orchestrator)
- [ ] 본인 환경에서 `pnpm dev` → frontend :3000 OK
- [ ] `tsc --noEmit` 0 error
- [ ] 본인 `.env.local`에 필요한 키 채워짐 (없어도 진행 가능, 단 AppSync/STT/TTS/LLM 호출 시점에 fail)
- [ ] git init + initial commit

**다음**:
- 본인만 끝났으면 → 다른 팀원 기다림
- 팀 전체가 끝났으면 → `/hk-backlog`
