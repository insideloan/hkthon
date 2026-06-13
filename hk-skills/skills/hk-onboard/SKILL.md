---
name: hk-onboard
description: 개발 환경 세팅, stack 검증, Tailwind template 흡수. 각 팀원이 1회 실행. 첫 implementation 전에 반드시 완료.
---

# hk-onboard — 환경 온보딩 / Environment Onboarding

> **목적 / Purpose**: 본인 노트북에 dev 환경 세팅 + 우리 stack/architecture 검증 + (선택) Tailwind template 흡수. **이게 끝나야 hk-implement 가능.**
> Set up dev environment, verify stack/architecture, optionally absorb a Tailwind template. Required before hk-implement.

---

## 1. 언제 쓰나 / When to use

- `hk-vision` 직후, **각자 1회** (팀원 4-5명이 각자 실행).
- 또는 본인 환경이 깨졌을 때 재실행.

**트리거 / Trigger phrases**:
- "환경 세팅하자" / "내 노트북 세팅"
- "onboard" / "셋업"

---

## 2. 입력 / Input

- `reference/PRODUCT-BRIEF.md` (있어야 — 없으면 hk-vision부터)
- (선택) 팀이 정한 Tailwind template의 GitHub URL
- 환경: macOS 또는 Linux, Python 3.11+, Node 20+

> **중요**: 사용자가 template URL을 안 줬으면, `hk-onboard`은 template 없이도 끝낼 수 있어야 함. 그 경우 `src/components/ui/*` wrapper는 일단 **placeholder(Tailwind 클래스 직접 사용한 임시 컴포넌트)** 로 시작. 나중에 template URL 생기면 이 skill을 다시 실행.

---

## 3. 진행 / Process

### 3.1 사전 점검 / Preflight

각 항목이 PASS인지 확인. FAIL이면 사용자에게 어떻게 설치하는지 안내.

```bash
# 1. Claude Code 설치 확인
claude --version     # OK면 진행. 없으면 https://docs.claude.com/claude-code 안내

# 2. Python
python3 --version    # 3.11+

# 3. Node / pnpm
node --version       # 20+
pnpm --version       # 없으면: npm install -g pnpm

# 4. uv (선택이지만 권장)
uv --version         # 없으면: brew install uv 또는 pip install uv
```

**모두 PASS일 때만 다음 단계로.**

### 3.2 프로젝트 디렉토리 생성 / Create project dir

```bash
mkdir -p ~/workspace/hackathon-2026
cd ~/workspace/hackathon-2026
```

이 디렉토리에서:
- `backend/` (FastAPI)
- `frontend/` (Next.js)
- `OWNER.md` (slice 분배 후 만들어짐, 지금은 빈 파일)
- `app.duckdb` (DuckDB, 나중에 생김)

### 3.3 Backend 세팅

`reference/STACK.md` §2를 그대로 따라 Claude가 실행:

```bash
mkdir -p backend && cd backend
# pyproject.toml 생성 (uv 또는 poetry)
uv init --no-readme
# 또는 pip-tools
# pyproject.toml에 STACK §2의 의존성 추가
uv add fastapi 'uvicorn[standard]' websockets duckdb duckdb-engine pydantic pydantic-settings httpx boto3 python-multipart
# 또는 OpenAI만 쓸 거면 boto3 제외

# .env.example 복사
# (STACK.md §2에 있는 env vars 그대로)
cp ~/.claude/reference/STACK.md .env.example  # 참고용
# 실제 .env는 사용자가 직접 채움
```

그리고 STACK.md의 §2 디렉토리 구조에 따라 `app/main.py`, `app/config.py` 등 **빈 파일**(stub) 생성. 내용은 `hk-implement`에서 채움.

**Backend 검증**:
```bash
cd backend
uv run uvicorn app.main:app --reload --port 8000 &
# 5초 대기
curl http://localhost:8000/health
# {"ok": true} 같은 응답이 와야 PASS
# 그리고 CORS 확인: http://localhost:3000 허용됐는지
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
# .env.example에 NEXT_PUBLIC_API_URL=http://localhost:8000
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

Backend + Frontend 동시 실행:

```bash
# backend
cd backend && uv run uvicorn app.main:app --port 8000 &

# frontend
cd frontend && pnpm dev
```

브라우저에서 `http://localhost:3000` → "Hello from API" 같은 게 보이면 PASS. 안 보이면:
- CORS 설정 확인 (`app/main.py`의 `CORSMiddleware` origins)
- `.env`의 `NEXT_PUBLIC_API_URL` 확인
- backend log 확인

---

## 4. 출력 / Output

### 4.1 생성된 파일 / Created files

```
~/workspace/hackathon-2026/
├── backend/  (FastAPI stub, .env.example, 의존성 설치 완료)
├── frontend/ (Next.js stub, wrapper components, 의존성 설치 완료)
└── OWNER.md  (비어있음, hk-slice 후 채워짐)
```

### 4.2 한국어 요약 (사용자에게)

```
✅ Onboard 완료
- Backend: http://localhost:8000 OK (CORS 설정됨)
- Frontend: http://localhost:3000 OK
- Stack: FastAPI + Next.js + DuckDB + Bedrock Claude Sonnet 4.6 + AWS Transcribe/AWS Polly
- Template: <사용했으면 URL, 안 했으면 "placeholder wrapper 사용 중">

문서:
- reference/ARCHITECTURE.md (구조)
- reference/STACK.md (의존성)
- reference/CONVENTIONS.md (규약)

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

- ❌ **새 의존성 추가 금지.** STACK.md에 있는 것만.
- ❌ **Tailwind template이 우리 wrapper 구조를 깨면** template을 거부하고 placeholder 유지. 24h에 template 통합 작업은 위험.
- ❌ **`.env` 파일 git에 커밋 금지.** `.env.example`만.
- ❌ **인증/DB 마이그레이션/배포 도구** 설치 금지 (out of scope).
- ✅ **`tsc --noEmit`이 0 error여야 PASS.**
- ✅ **`uvicorn` health check가 200이어야 PASS.**
- ✅ **.env에 실제 API key 입력 시 git에 안 들어갔는지 확인.**

---

## 6. 트러블슈팅 / Troubleshooting

| 증상 | 원인 | 해결 |
|---|---|---|
| `pnpm dev` → "port 3000 in use" | 다른 process | `lsof -ti:3000 | xargs kill -9` |
| `uvicorn` → "ModuleNotFoundError" | 의존성 미설치 | `uv add <module>` |
| Frontend에서 backend 호출 시 CORS error | origins 빠짐 | `app/main.py`의 `CORSMiddleware(allow_origins=["http://localhost:3000"])` |
| `pnpm tsc` → "Cannot find module '@/...'" | path alias | `tsconfig.json`에 `paths: {"@/*": ["./src/*"]}` |
| Template이 React 18 기반 | 우리 stack 19 | template을 그대로 안 쓰고 wrapper interface만 차용 |

---

## 7. 다음 단계로 / Hand-off

**조건**:
- [ ] 본인 환경에서 backend health check 200
- [ ] 본인 환경에서 frontend 3000 OK
- [ ] `tsc --noEmit` 0 error
- [ ] 본인 `.env`에 필요한 키 채워짐 (없어도 진행 가능, 단 STT/TTS/LLM 호출 시점에 fail)
- [ ] git init + initial commit

**다음**:
- 본인만 끝났으면 → 다른 팀원 기다림
- 팀 전체가 끝났으면 → `/hk-backlog`
