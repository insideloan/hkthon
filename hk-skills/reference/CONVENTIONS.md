# CONVENTIONS — 코딩 규약 / Coding Conventions

> **모든 코드는 이 규약을 따릅니다. 어기면 PR 리뷰에서 반려.**
> **All code follows these conventions. Violations get rejected in review.**

---

## 1. 언어 / Language

- **변수, 함수, 파일, 주석 코드**: 영어
- **사용자-facing 텍스트** (UI label, LLM system prompt, TTS script): 한국어
- **커밋 메시지**: 영어 또는 한국어, 자유
- **문서** (md): 본문 한국어 primary, 코드/identifier는 영어

---

## 2. 명명 / Naming

| 대상 | 규칙 | 예시 |
|---|---|---|
| Python 함수/변수 | snake_case | `def start_call(customer_id)` |
| Python 클래스 | PascalCase | `class CallOrchestrator` |
| Python 상수 | UPPER_SNAKE | `MAX_TURNS = 20` |
| TypeScript 변수/함수 | camelCase | `const queueRows = []` |
| TypeScript 컴포넌트 | PascalCase | `OutboundQueueTable` |
| TypeScript 타입/인터페이스 | PascalCase | `type AgentMsg` |
| DB 테이블 | snake_case, 복수형 | `customers`, `transcripts` |
| DB 컬럼 | snake_case | `customer_id`, `started_at` |
| API endpoint | kebab-case, 복수 | `/api/outbound-queue`, `/api/calls` |
| WebSocket 메시지 type | snake_case, UPPER_SNAKE 값 | `{type: "queue_update"}` |
| React 컴포넌트 파일 | PascalCase.tsx | `MemoPopup.tsx` |
| 비-컴포넌트 TS 파일 | camelCase.ts | `api.ts`, `ws.ts` |
| Python 파일 | snake_case.py | `agent_ws.py` |

---

## 3. 파일 구조 / File Structure

### 3.1 Backend (Python)

- 한 파일 = 한 책임 (Single Responsibility)
- 모듈은 `app/<domain>/<thing>.py`
- 순환 import 금지. 필요하면 `app/dependencies.py`에서 wire
- Public API는 `__init__.py`에서 명시적으로 re-export

### 3.2 Frontend (TypeScript)

- 모든 컴포넌트는 `src/components/<area>/<Name>.tsx`
- **Wrapper components**는 `src/components/ui/<Name>.tsx`
- 페이지 = `src/app/<route>/page.tsx`
- **상태 관리**: 서버 데이터는 React Query/SWR 또는 zustand, UI 로컬은 useState
- **절대 금지**: `useEffect`에서 직접 fetch. lib/api.ts 통해서.

---

## 4. TypeScript 규칙 / TS Rules

```ts
// ✅ 명시적 타입
function startCall(customerId: string): Promise<Call> { ... }

// ❌ any 금지
function startCall(customerId: any): any { ... }  // ← 반려

// ✅ 옵셔널은 ?
type Memo = { id: string; content: string; createdAt?: string };

// ✅ Union for messages
type AgentMsg =
  | { type: 'queue_update'; rows: QueueRow[] }
  | { type: 'transcript'; speaker: 'agent' | 'customer'; text: string };

// ❌ Type assertion 남용 금지
const rows = data as QueueRow[];  // ← 가능하면 zod parse
const rows = QueueRowSchema.array().parse(data);
```

**공유 타입**: `frontend/src/types/*`에 정의. backend가 OpenAPI로 export하면 그거 import. 안 그러면 손으로 mirror + 주석으로 출처 표시.

---

## 5. Python 규칙 / Python Rules

```python
# ✅ Type hints
async def stream_chat(messages: list[Message], system: str) -> AsyncIterator[str]: ...

# ✅ Pydantic으로 validation
class StartCallRequest(BaseModel):
    customer_id: str

# ❌ print 디버깅 금지 (logger 사용)
import logging
log = logging.getLogger(__name__)
log.info("call started", extra={"call_id": call_id})

# ✅ 예외는 좁게
try:
    result = await llm.complete(prompt)
except LLMTimeout:
    log.warning("llm timeout, retrying")
    result = await llm.complete(prompt)

# ❌ bare except 금지
```

---

## 6. Tailwind 규칙 / Tailwind Rules

### 6.1 Wrapper 패턴 (필수)

**Template 교체 용이성**을 위해, 모든 UI 컴포넌트는 wrapper를 통해 들어갑니다:

```tsx
// ❌ 금지: Tailwind 클래스를 컴포넌트에 직접
export function QueueRow({ row }: { row: QueueRow }) {
  return <tr className="border-b border-gray-200 hover:bg-gray-50">...</tr>;
}

// ✅ 권장: wrapper 사용
import { TableRow } from '@/components/ui/Table';
export function QueueRow({ row }: { row: QueueRow }) {
  return <TableRow variant="queue">{row.name}</TableRow>;
}
```

wrapper는 `src/components/ui/*`에 있고, 내부에서 Tailwind 클래스 사용. Template 교체 시 **이 폴더만** 갈아끼우면 됨.

### 6.2 Theme는 `tailwind.config.ts`에만

색상, 폰트, 간격은 전부 `tailwind.config.ts`의 `theme.extend`:

```ts
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        primary: { 50: '#...', 500: '#...', 900: '#...' },
        // queue 색상은 고정 (의미가 있는 색이므로)
        'queue-active': '#fbbf24',     // 노란
        'queue-noanswer': '#1f2937',   // 검정
        'queue-rejected': '#92400e',   // 갈색
        'queue-signup': '#10b981',     // 초록
        'queue-escalate': '#ef4444',   // 빨강
      },
    },
  },
};
```

**queue 색상은 의미가 있으므로** theme.color에 고정. Template 갈아끼워도 이 색은 보존.

### 6.3 Inline style 금지

```tsx
// ❌
<div style={{ padding: 8, color: 'red' }}>

// ✅
<div className="p-2 text-red-500">
```

### 6.4 Tailwind Template 흡수 절차

해커톤 당일 팀이 template URL을 주면:

1. `hk-onboard` skill이 template의 컴포넌트들을 읽음
2. 우리 `src/components/ui/*` wrapper와 1:1 매핑 작성
3. `tailwind.config.ts`의 theme.extend만 template에 맞춰 조정
4. 우리 페이지/스토어는 wrapper interface가 같으면 변경 0

상세는 `hk-onboard` SKILL.md 참고.

---

## 7. Git 규칙 / Git Rules

> **24h 해커톤 Git 운영의 SSOT는 `docs/MODULES.md` + `docs/WORKFLOW.md`.**
> 본 섹션은 그 두 문서의 **요약**이며, 실제 충돌/PR/머지 상황은 그쪽을 본다.

### 7.1 5 modules, 4 people, 1 hub

- `QUEUE` (Person A), `PHONE` (Person B), `CALL+MEMO` (Person C), `ORCH` (Person D)
- 각자 **자기 모듈 안에서는 자유 push** (pre-push hook이 자동 체크)
- **다른 모듈 변경은 PR 필수**
- 자세한 file ownership matrix: `docs/MODULES.md` §2
- 자세한 머지 우선순위/SLA: `docs/WORKFLOW.md` §3

### 7.2 Branch 전략

- `main` — 항상 `pnpm dev` + `uvicorn`이 로컬에서 실행 가능. **PR로만 머지.**
- 작업 브랜치: `<MODULE>-<NNN>-<short-desc>` (예: `QUEUE-001-outbound-table`)
- 24h 안에서는 **squash merge 권장** (history 깨끗)
- 자기 모듈 작업 시 rebase: `git fetch && git rebase origin/main && git push --force-with-lease`

### 7.3 커밋 메시지

```
<type>(<scope>): <subject>

<body>

type: feat | fix | refactor | docs | test | chore
scope: backend | frontend | infra | slice
```

예: `feat(slice/S1-greet): add greeting node LLM prompt`

### 7.4 Pre-push hook (자동 강제)

`setup-project.sh`가 다음 hook을 `.githooks/pre-push`에 설치:

```bash
# 모듈 boundary 자동 체크
# 본인이 모듈 A owner인데 모듈 B 파일이 변경되었으면 push block
# TEAM LOCK 파일 (tailwind.config, package.json 등)도 push block
# --no-verify로 우회 금지
```

**훅이 push를 막으면 → 다른 사람 모듈 파일을 건드린 것 → PR로 처리하거나 revert**.

### 7.5 충돌 / PR 우선순위

- **PR이 떠 있으면 같은 파일 작업 전에 그 PR을 먼저 머지** (WORKFLOW.md §3.3)
- **Schema 변경 (ORCH PR)** 머지 후 → 다른 모듈이 자기 코드 update 후 push
- **1시간 sync 권장** (4-6시간 단위, 음성)

### 7.6 의존성 추가 (TEAM LOCK)

`package.json` / `pnpm-lock.yaml` / `pyproject.toml` / `uv.lock` / `tailwind.config.ts` 변경은 **PR + 모든 팀원 approve**. `INFRA-NNN-add-<dep>` issue로 합의 먼저. 상세: `docs/WORKFLOW.md` §4.

### 7.7 Owner / 모듈 합의

- 모듈 owner 누구든 push 가능: `OWNER.md`, `docs/slices/`, `templates/*` (의미 없는 변경은 자제)
- 모듈 owner 합의 필수: `docs/MODULES.md`, `docs/WORKFLOW.md`, `docs/reference/*`

---

## 8. 의존성 추가 프로세스 / Adding Dependencies

**기본: 추가 금지**. 정말 필요하면:

1. PR에 사유 + 대안 + 24h 내 risk 명시
2. 팀 리드 승인
3. `reference/STACK.md` 업데이트
4. `pnpm-lock.yaml` 또는 `pyproject.toml` lock 갱신

> 24h 안에 dependency 추가는 9/10 위험. **대부분의 필요는 우리가 이미 가진 것들로 해결 가능.**

---

## 9. 코드 리뷰 체크리스트 / Code Review Checklist

PR 올릴 때 본인이 self-check:

- [ ] `STACK.md`의 의존성만 사용
- [ ] `ARCHITECTURE.md`의 디렉토리 구조 따름
- [ ] 명명 규칙 (Section 2) 따름
- [ ] TypeScript: `any` 없음, 모든 함수에 타입
- [ ] Python: type hints, logger, 좁은 except
- [ ] Tailwind: wrapper 패턴, inline style 없음
- [ ] 새 의존성 없음
- [ ] `.env` 같은 secret 없음
- [ ] OWNER.md에 명시된 파일만 변경
- [ ] 로컬에서 한 번 실행해서 동작 확인
- [ ] 한국어 UI 텍스트는 자연스러움

---

## 10. 한국어 텍스트 / Korean Text

- 모든 UI 라벨: 자연스러운 한국어. 번역투 금지.
- LLM system prompt: 한국어. 단, JSON schema 정의는 영어.
- TTS script: 한국어 구어체. (예: "안녕하세요, AI 상담원입니다" ❌ → "안녕하세요, AI 상담원이에요" ⭕)
- 주석 안의 한국어/영어 자유.

---

## 11. 에러 메시지 / Error Messages

```python
# ✅ 한국어 + action 가능
raise ValueError("고객 ID가 필요합니다. /api/calls/start 요청에 customer_id를 포함하세요.")

# ❌ stack trace 그대로 노출
raise Exception("KeyError: customer_id")
```

UI: `toast.error("통화를 시작할 수 없습니다. 잠시 후 다시 시도해주세요.")` 같이 친절하게.
