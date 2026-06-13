# hk-skills — 해커톤용 Claude Code Skills

> **Claude Code Skills for Non-Dev Hackathon Teams / 비개발자 해커톤 팀을 위한 Claude Code Skills**
>
> 코드를 한 줄도 모르는 4-5명 팀이 24시간 안에 **AI Outbound 콜봇 데모**를 만들 수 있도록 설계된 SDLC 스킬 + **모듈 분할 + Git 운영** 패키지입니다.
> A collection of Claude Code skills + **module split + git workflow** that lets a zero-dev team of 4-5 ship a working AI outbound call bot in 24 hours.

---

## ✨ 이게 뭔가요 / What is this?

해커톤에서 Claude Code를 **개발자 역할**로 두고, 팀(사용자)은 **Product Owner 역할**만 하도록 SDLC를 재설계한 일련의 스킬입니다.

- **사용자(팀)**: "무엇을" 만들지만 결정. 코드는 안 침.
- **Claude Code**: "어떻게" 구현할지 결정. Skill이 그 진행을 가이드.
- **각 Skill**: 명확한 입출력과 가드레일을 가진 한 단계.
- **모듈 분할**: 4명이 **파일 충돌 없이** 병렬로 작업. 각자 자기 모듈만 push.
- **Git 운영**: Issue 추적 + PR 머지 프로토콜로 24h 안에 main이 깨지지 않게.

| 단계 | Skill | 누가 | When | 산출물 / Output |
|---|---|---|---|---|
| 0 | `hk-vision` | **팀리더** | 시작 전, 1회 | `PRODUCT-BRIEF.md` |
| 1 | `hk-onboard` | **팀원 각자** | 각자 1회 | 작동하는 dev 환경 + `STACK.md` 검증 |
| 2 | `hk-backlog` | **팀리더** | 1회 | `BACKLOG.md` + GitHub issues |
| 3 | `hk-slice` | **팀리더** (owner 배정) + **팀원** (자기 모듈 issue 합의) | 기능당 1회 | `slices/<id>/SLICE.md` + `OWNER.md` 갱신 |
| 4 | `hk-implement` | **팀원 각자** (본인 owner issue) | 슬라이스당 1회 | merge된 코드 + 통과한 verify |
| 5 | `hk-verify` | **팀원 각자** (본인 PR self-verify) + **팀원** (reviewer-verify) | 슬라이스당 1회 | 검증된 슬라이스 |
| 6 | `hk-demo` | **팀리더** (시나리오 작성) + **팀원 각자** (본인 모듈 리허설) | 마지막 2시간 | 데모 시나리오 + 리허설 |

### 모듈 구성 (4명 = 5 modules) / Module layout

| 코드 | Owner | 영역 |
|---|---|---|
| **QUEUE** | Person A | 상담원 큐 테이블 |
| **PHONE** | Person B | 고객 iPhone UI |
| **CALL** + **MEMO** | Person C | 통화 화면 + 메모 팝업 |
| **ORCH** | Person D | 오케스트레이터 + State Machine + LLM/STT/TTS |

> 상세 file ownership: `docs/MODULES.md`
> 머지 프로토콜 / 이슈 추적: `docs/WORKFLOW.md`

---

## 📦 설치 / Installation

### 사전 요구 / Prerequisites

- macOS 또는 Linux
- Claude Code 최신 버전 (https://docs.claude.com/claude-code)
- Python 3.11+
- Node.js 20+
- (선택) Naver Clova API 키, AWS Bedrock 또는 OpenAI API 키

### 원라이너 설치 (권장) / One-liner Install

```bash
# 최신 릴리스
curl -fsSL https://raw.githubusercontent.com/insideloan/hkthon/main/hk-skills/install.sh | bash

# 특정 버전 고정
curl -fsSL https://raw.githubusercontent.com/insideloan/hkthon/main/hk-skills/install.sh | bash -s -- --version v1.0.0
```

설치 스크립트는 다음을 수행합니다:
- GitHub Releases에서 tarball을 받아 `~/.claude/hk-skills/<version>/`에 풀기
- `~/.claude/skills/hk-*` 7개 심볼릭 링크 생성
- `reference/` 폴더를 `~/.claude/reference/`로 복사
- `templates/` 폴더를 `~/.claude/templates/`로 복사
- 설치 검증 / Verifies installation

### git clone 설치 / Install via Clone

```bash
# 1. 레포 클론 / Clone
git clone https://github.com/insideloan/hkthon.git
cd hkthon/hk-skills

# 2. 설치 스크립트 실행 / Run installer
./install.sh
```

### 수동 설치 / Manual Install

```bash
# macOS / Linux
mkdir -p ~/.claude/skills
ln -s "$(pwd)/skills/hk-vision"   ~/.claude/skills/hk-vision
ln -s "$(pwd)/skills/hk-onboard"  ~/.claude/skills/hk-onboard
ln -s "$(pwd)/skills/hk-backlog"  ~/.claude/skills/hk-backlog
ln -s "$(pwd)/skills/hk-slice"    ~/.claude/skills/hk-slice
ln -s "$(pwd)/skills/hk-implement" ~/.claude/skills/hk-implement
ln -s "$(pwd)/skills/hk-verify"   ~/.claude/skills/hk-verify
ln -s "$(pwd)/skills/hk-demo"     ~/.claude/skills/hk-demo

mkdir -p ~/.claude/reference ~/.claude/templates
cp -r reference/*  ~/.claude/reference/
cp -r templates/*  ~/.claude/templates/
```

### 설치 확인 / Verify

```bash
# Claude Code 안에서:
# "어떤 hk 스킬이 있어?" 또는 "list hk skills"
# Claude가 7개 스킬을 모두 인식하면 성공.
```

---

## 🏗️ 해커톤 프로젝트 시작 / Bootstrap a Hackathon Project

`install.sh`는 **Claude Code 스킬**만 설치합니다. 실제 hackathon 프로젝트 디렉토리는 `setup-project.sh`로 별도 생성합니다.

`./install.sh` only installs the **Claude Code skills**. Use `./setup-project.sh` to bootstrap the actual hackathon project.

```bash
# 1) 스킬 설치 (한 번만)
./install.sh

# 2) 본인 모듈 등록하면서 프로젝트 부트스트랩
./setup-project.sh --module QUEUE    # Person A
./setup-project.sh --module PHONE    # Person B
./setup-project.sh --module CALL     # Person C
./setup-project.sh --module ORCH     # Person D
# 또는
./install.sh --setup-project --module QUEUE
```

생성 결과 (`~/workspace/hackathon-2026/`):
```
hackathon-2026/
├── backend/                   # FastAPI (BE 모듈은 여기)
├── frontend/                  # Next.js (FE 모듈은 여기)
├── docs/
│   ├── MODULES.md            # 모듈 정의 + file ownership matrix
│   ├── WORKFLOW.md           # 이슈/PR/머지 프로토콜
│   ├── reference/            # PRODUCT-BRIEF/ARCHITECTURE/STACK/CONVENTIONS
│   └── templates/            # issue-spec/verify-checklist
├── OWNER.md                   # 모듈 owner + active issues
├── .githooks/pre-push         # 모듈 boundary 자동 체크
└── .github/
    ├── ISSUE_TEMPLATE/hk-task.md
    └── PULL_REQUEST_TEMPLATE.md
```

`setup-project.sh`는 자동으로:
- `git init` + `.githooks` 설정 (pre-push hook 활성화)
- `git config hk.module <본인모듈>` 등록
- 디렉토리 스캐폴드 + 초기 commit

### 모듈 boundary 자동 체크 / Auto enforcement

`pre-push` hook이 push 시점마다:
1. 본인이 owner인 모듈 (`git config hk.module`)을 확인
2. push하려는 commit에서 변경된 파일 목록을 가져옴
3. 그 파일들이 본인 모듈에 속하는지 `docs/MODULES.md` §2 매트릭스로 검증
4. **다른 모듈 파일이 섞여 있으면 push block** + 에러 메시지

```
[pre-push] ❌ PUSH BLOCKED
You are module 'QUEUE', but these files belong to other modules:
  - backend/app/ws/agent_ws.py  (owned by QUEUE)   ← OK
  - frontend/src/components/phone/PhoneFrame.tsx  (owned by PHONE)  ← VIOLATION

Options:
  1) Revert the offending file changes
  2) Open a PR instead
```

**이 hook은 24h의 안전망입니다.** 우회 (`--no-verify`) 절대 금지.

---

## 🔀 Git 운영 요약 / Git Workflow at a Glance

**상세**: `docs/WORKFLOW.md` (이걸로 다 커버됨). Quick reference:

### Issue (작업 1건)

```bash
gh issue create \
  --title "QUEUE-001-outbound-table" \
  --body-file docs/templates/issue.md \
  --label "status:ready,module:queue,priority:p0"
```

Title format: `<MODULE>-<NNN>-<short-kebab-desc>`

### PR

```bash
git checkout -b QUEUE-001-outbound-table
# ... 작업 ...
git push -u origin HEAD
gh pr create \
  --title "[QUEUE] add outbound table component" \
  --body-file docs/templates/pr.md \
  --reviewer personB
```

Title format: `[<target-module>] <description>`

### 머지 우선순위 / Merge priority

> **PR이 떠 있으면 같은 파일 작업 전에 그 PR을 먼저 머지.**

| PR 종류 | Reviewer | 머지 SLA |
|---|---|---|
| 자기 모듈 | 아무나 1명 approve | 1h |
| 다른 모듈 | **그 모듈 owner** | 1h |
| TEAM LOCK (의존성, MODULES.md) | **모든 팀원** | 30m |
| Schema 변경 (ORCH) | ORCH + 사용 모듈 owner | 30m |
| `🚨 URGENT` | 즉시 | 5m |

### 충돌 났을 때

```bash
git fetch origin
git rebase origin/main
# 충돌 해결
git push --force-with-lease
```

**`--force`는 절대 금지. `--force-with-lease`만 사용.**

---

## 🚀 사용 흐름 / Usage Flow

해커톤 시작 후 24시간을 이렇게 씁니다:

```
[해커톤 시작 - 0h]
  ↓ /hk-vision         ← 팀 전체, 30분. Product brief lock-in
  ↓ /hk-onboard        ← 각자, 30분. 환경 세팅 + stack 확인
  ↓
[계획 - 2h]
  ↓ /hk-backlog        ← 팀 전체, 30분. Feature 후보 정리
  ↓ /hk-slice (×N)     ← 팀 전체, 1h. Feature를 슬라이스로 분해 + owner 배정
  ↓
[구현 - 18h]
  ↓ 각자 본인 슬라이스에 대해 /hk-implement → /hk-verify 루프
  ↓ (슬라이스 1개당 1-2시간 목표)
  ↓
[마무리 - 4h]
  ↓ 통합 / 통합 테스트
  ↓ /hk-demo           ← 데모 시나리오 작성 + 리허설
  ↓
[해커톤 종료]
```

### 핵심 규칙 / Key Rules

1. **순서 엄수** — `hk-vision` → `hk-onboard` → `hk-backlog` → `hk-slice` → `hk-implement` → `hk-verify` → `hk-demo`
2. **OWNER.md 우선** — 본인 슬라이스만 `hk-implement` 실행. 다른 사람 슬라이스는 손대지 않음.
3. **실패 시** — `hk-verify`가 FAIL이면 같은 슬라이스에 대해 `hk-implement`을 다시 실행 (자동 재진입)
4. **.env는 git에 올리지 않기** — `.env.example`만 공유

---

## 🏗️ 제품 (참고) / The Product

이 스킬들은 다음 제품을 가정하고 설계되었습니다:

**AI Outbound 금융상품 Sales Call Bot**

- 콜센터 상담원 대시보드 + 고객(가짜 iPhone UI) + AI 봇
- 상담원이 outbound call queue를 보고 고객에게 자동 전화
- AI 봇이 2가지 시나리오로 세일즈:
  1. 고객이 상품 관심/한도조회 요청 → 상담원 연결
  2. 보이스피싱 피해 의심 → AI가 위험 안내 후 통화 종료
- 상담원 UI: 대시보드 (대기 콜/진행 중/상담원 연결 필요) + 실시간 통화 모니터링 (고객 정보/위험도/AI 분석) + 통화 요약

**아키텍처 / Stack**: FastAPI + Next.js + Tailwind + SQLite + Bedrock Claude / OpenAI + Naver Clova STT/TTS
상세는 `reference/ARCHITECTURE.md`, `reference/STACK.md` 참고.

> 다른 제품에도 적용 가능합니다 — 이 경우 `reference/PRODUCT-BRIEF.md`만 갈아끼우면 됩니다.

---

## 🌍 언어 / Language

- **Skill 본문**: 한국어 primary + 영어 secondary
- **README**: 한국어 primary
- **Code/identifier**: 영어
- 사용자(팀)는 한국어로, Claude는 bilingual로 응답합니다.

---

## 🤝 기여 / Contributing

내부 사용 후 개선사항은 PR로 보내주세요. 특히:
- `hk-implement`이 비개발자에게 막히는 지점
- `hk-verify` checklist가 실제 검증에 부족한 부분
- 새 시나리오나 stack 추가

---

## 📄 라이선스 / License

MIT
