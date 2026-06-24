// OutboundQueueTable — admin dashboard call list (FRONTEND-001 / #30).
// Initial load: `queue` query; realtime: `onQueueUpdate` subscription (lib/appsync.ts).
// Consumes the queue store; styling only via ui/* wrappers (CONVENTIONS.md §6.1).
'use client';

import { useEffect, useState } from 'react';
import type React from 'react';
import { clsx } from 'clsx';
import { useRouter } from 'next/navigation';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { RiskBar } from '@/components/ui/RiskBar';
import { deleteQueueRow, fetchQueue, subscribeQueueUpdates } from '@/lib/appsync';
import { useQueueStore } from '@/stores/queueStore';
import type { CallState, QueueRow } from '@/types/queue';

// Call state → human label (Korean) + badge tone. Mirrors SDL `enum CallState`.
const STATE_LABEL: Record<CallState, string> = {
  CREATED: '대기중',
  DIALING: '발신중',
  IN_CALL: '통화중',
  TRANSFER_PENDING: '상담원 연결 대기',
  ENDED: '종료',
};

const STATE_TONE: Record<CallState, BadgeTone> = {
  CREATED: 'noanswer',
  DIALING: 'noanswer',
  IN_CALL: 'active',
  TRANSFER_PENDING: 'escalate',
  ENDED: 'neutral',
};

/** Map a row's highlight flag to row background style (warm semi-transparent palette). */
function rowHighlightStyle(highlight: QueueRow['highlight']): React.CSSProperties {
  if (highlight === 'needs_agent') return { background: 'rgba(239,68,68,.05)' };
  if (highlight === 'fraud_suspected') return { background: 'rgba(217,119,6,.06)' };
  return {};
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** First character of customer name, used as avatar initial. */
function nameInitial(name: string | null | undefined): string {
  return name?.charAt(0) || '?';
}

// ─── Row → screen navigation ─────────────────────────────────────────────────
// Clicking a call row drills into the matching screen, keyed by the call's state
// (SSOT: docs/consult_redesigned-3.html admin call-list → detail flow):
//   ENDED            → 상담 CRM (/crm) — past call summary + customer profile
//   IN_CALL          → AI 상담화면 (/calls) — joins mid-conversation
//   DIALING          → AI 상담화면 (/calls) — booth demo from the call's start
//   TRANSFER_PENDING → not navigable yet (awaiting agent assignment)
//   CREATED          → 사전 분석 중 (/segment) — pre-call analysis screen
//
// The 박서준 demo row is the showcase entry point: clicking it must always play
// the scripted 세그먼트 분석 → 발신 → 상담 flow (불특정 발신중 행처럼 곧장 상담
// 화면으로 가면 안 된다). We pin it by callId so the routing can't drift — the
// deployed backend's stage string for this row has diverged from the seed source,
// so matching on stage alone is unreliable. Maps the demo callId → seed customerId
// for the /segment screen (wire QueueRow has no customerId yet; see types/queue.ts).
const DEMO_CALL_TO_CUSTOMER_ID: Record<string, string> = {
  'c-demo-01': 'cust-001',
};

// 다른 사전 분석 중 행들도 customerId 가 매핑되면 세그먼트 화면으로 보낸다.
const DEMO_NAME_TO_CUSTOMER_ID: Record<string, string> = {
  박서준: 'cust-001',
};

const PRE_ANALYSIS_STAGE = '사전 분석 중';

// 시연 시나리오의 시작점(박서준)이라 큐에서 사라지면 데모 흐름이 깨진다.
// 이 행은 휴지통 버튼을 렌더하지 않아 삭제를 원천 차단한다.
const UNDELETABLE_CALL_IDS = new Set(['c-demo-01']);

// 체험(experience) 버튼으로 생성된 행은 callId가 exp-* 다. 데모(scripted) 재생이
// 아니라 실제 라이브 세션(마이크→STT→agent→TTS)으로 진입한다.
function isExperienceRow(row: QueueRow): boolean {
  return (row.callId ?? '').startsWith('exp-');
}

/** Resolve the target href for a row, or null when the row isn't navigable. */
function rowHref(row: QueueRow): string | null {
  // 체험 고객(exp-*) → 라이브 상담 화면(?live=1). mock 시나리오 재생이 아님.
  if (isExperienceRow(row)) {
    return `/calls/${row.callId}?live=1`;
  }
  // 데모 쇼케이스 행(박서준/c-demo-01)은 stage 값과 무관하게 항상 세그먼트
  // 분석 화면을 거쳐 발신/상담으로 넘어간다.
  const demoCustomerId = DEMO_CALL_TO_CUSTOMER_ID[row.callId ?? ''];
  if (demoCustomerId) {
    return `/segment/${demoCustomerId}`;
  }
  // 그 외 사전 분석 중 단계 행 → 세그먼트 분석 화면(customerId 매핑된 경우만).
  if (row.stage === PRE_ANALYSIS_STAGE) {
    const customerId = DEMO_NAME_TO_CUSTOMER_ID[row.customerName ?? ''];
    return customerId ? `/segment/${customerId}` : null;
  }
  switch (row.state) {
    case 'ENDED':
      return `/crm/${row.callId}`;
    case 'IN_CALL':
    case 'DIALING':
      return `/calls/${row.callId}`;
    case 'TRANSFER_PENDING':
    case 'CREATED':
    default:
      return null; // 상담원 연결 대기 등은 아직 진입점 없음
  }
}

type OutboundQueueTableProps = {
  /** When true, skip data wiring (load + subscribe). Tests seed the store directly. */
  disableLiveData?: boolean;
  /**
   * Pre-filtered rows from the parent page (e.g. after filter-tab selection).
   * When omitted the component renders all rows from the store.
   */
  filteredRows?: QueueRow[];
};

// Data-load status for the empty body — distinguishes "loading", "no calls",
// and "connection error" so the operator never sees an unexplained blank.
type LoadStatus = 'loading' | 'ready' | 'error';

// ─── SSOT adm-table header + row styles ──────────────────────────────────────
// Trailing `36px` track holds the per-row delete (휴지통) action.
const GRID_COLS = '2.2fr 1fr 1.3fr 1.1fr 1.1fr .9fr .8fr 36px';

export function OutboundQueueTable({
  disableLiveData = false,
  filteredRows,
}: OutboundQueueTableProps) {
  const router = useRouter();
  const storeRows = useQueueStore((s) => s.rows);
  const setQueue = useQueueStore((s) => s.setQueue);
  const removeRow = useQueueStore((s) => s.removeRow);
  // When live data is disabled (tests seed the store), treat as ready.
  const [status, setStatus] = useState<LoadStatus>(disableLiveData ? 'ready' : 'loading');

  useEffect(() => {
    if (disableLiveData) return;
    let active = true;
    fetchQueue()
      .then((result) => {
        if (!active) return;
        setQueue(result);
        setStatus('ready');
      })
      .catch((err) => {
        console.error('queue 초기 로드 실패', err);
        if (active) setStatus('error');
      });
    const unsubscribe = subscribeQueueUpdates(
      (result) => {
        setQueue(result);
        setStatus('ready');
      },
      (err) => {
        console.error('onQueueUpdate 구독 오류', err);
        setStatus((prev) => (prev === 'ready' ? prev : 'error'));
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [disableLiveData, setQueue]);

  // 휴지통 클릭: 낙관적으로 행을 즉시 제거하고 백엔드 영구 삭제를 호출한다.
  // 실패하면 스냅샷을 재조회해 행을 되살린다(낙관 제거 롤백).
  const handleDelete = (callId: string) => {
    removeRow(callId);
    if (disableLiveData) return; // 테스트/오프라인: 로컬 제거만.
    deleteQueueRow(callId).catch((err) => {
      console.error('queue row 삭제 실패', err);
      fetchQueue()
        .then(setQueue)
        .catch((e) => console.error('삭제 롤백용 재조회 실패', e));
    });
  };

  // Use filteredRows from parent when provided; otherwise fall back to all store rows.
  const rows = filteredRows ?? storeRows;

  // Empty-body message when there are no rows.
  const emptyMessage =
    status === 'loading' ? '콜 큐를 불러오는 중…'
    : status === 'error' ? '큐 데이터를 불러오지 못했습니다. 연결을 확인해 주세요.'
    : '현재 진행 중인 콜이 없습니다.';

  return (
    <div>
      {/* ── adm-head ── */}
      <div
        className="grid gap-[10px] items-center px-4 py-[11px] font-mono text-[10px] font-bold uppercase tracking-[.08em]"
        style={{
          gridTemplateColumns: GRID_COLS,
          color: 'var(--ink-faint)',
          background: 'rgba(255,255,255,.4)',
          borderBottom: '1px solid var(--hair)',
        }}
      >
        <span>고객</span>
        <span>연결 상태</span>
        <span>상담 단계</span>
        <span>이탈 가능성</span>
        <span>담당 Agent</span>
        <span>통화 시간</span>
        <span>채널</span>
        <span className="sr-only">삭제</span>
      </div>

      {/* ── rows ── */}
      {rows.length === 0 ? (
        <div
          data-testid="queue-empty"
          className={clsx(
            'px-4 py-10 text-center text-sm',
            status === 'error' ? 'text-red-500' : 'text-gray-400',
          )}
        >
          {emptyMessage}
        </div>
      ) : (
        rows.map((row) => {
          const href = rowHref(row);
          const navigable = href !== null;
          return (
          <div
            key={row.callId}
            data-testid={`queue-row-${row.callId}`}
            data-highlight={row.highlight ?? 'none'}
            data-navigable={navigable}
            role={navigable ? 'link' : undefined}
            tabIndex={navigable ? 0 : undefined}
            aria-label={navigable ? `${row.customerName ?? row.callId} 상세 보기` : undefined}
            onClick={navigable ? () => router.push(href) : undefined}
            onKeyDown={
              navigable
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      router.push(href);
                    }
                  }
                : undefined
            }
            className={clsx(
              'grid gap-[10px] items-center px-4 py-[11px] transition-colors',
              'border-b last:border-b-0',
              navigable
                ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--route)] focus-visible:ring-inset'
                : 'cursor-default',
              row.highlight === 'needs_agent' && 'bg-red-50',
              row.highlight === 'fraud_suspected' && 'bg-amber-50',
              !row.highlight && navigable && 'hover:bg-[rgba(53,81,214,0.06)]',
            )}
            style={{
              gridTemplateColumns: GRID_COLS,
              borderColor: 'var(--hair)',
              ...rowHighlightStyle(row.highlight),
            }}
          >
            {/* 고객 — avatar + name + sub */}
            <div className="flex items-center gap-[9px] min-w-0">
              <span
                className="flex-none w-[30px] h-[30px] rounded-full grid place-items-center font-disp text-[13px] font-[800] text-white"
                style={{ background: 'linear-gradient(135deg,#2563eb,#4d7cf0)' }}
                aria-hidden="true"
              >
                {nameInitial(row.customerName)}
              </span>
              <div className="flex flex-col gap-0 min-w-0">
                <span
                  className="text-[13.5px] font-[800] truncate inline-flex items-center gap-1"
                  style={{ color: 'var(--ink)' }}
                >
                  {row.customerName || '—'}
                  {navigable && (
                    <span
                      className="text-[11px] font-normal"
                      style={{ color: 'var(--route)' }}
                      aria-hidden="true"
                    >
                      ↗
                    </span>
                  )}
                </span>
                <span className="text-[10.5px] truncate" style={{ color: 'var(--ink-dim)' }}>
                  {row.subtitle || row.callId}
                </span>
              </div>
            </div>

            {/* 상태 badge */}
            <div>
              {row.state ? (
                <Badge tone={STATE_TONE[row.state]}>{STATE_LABEL[row.state]}</Badge>
              ) : (
                <span className="text-xs text-gray-400">—</span>
              )}
            </div>

            {/* 현 단계 */}
            <span className="text-[12.5px] font-bold truncate" style={{ color: 'var(--ink)' }}>
              {row.stage || '—'}
            </span>

            {/* 이탈위험 */}
            <div>
              {typeof row.churnRisk === 'number' ? (
                <RiskBar value={row.churnRisk} />
              ) : (
                <span className="text-xs text-gray-400">—</span>
              )}
            </div>

            {/* 담당 */}
            <span className="text-[12.5px]" style={{ color: 'var(--ink-dim)' }}>
              {row.assignee || (row.highlight === 'needs_agent' ? '상담원' : 'AI')}
            </span>

            {/* 통화시간 */}
            <span
              className="text-[12.5px] tabular-nums font-mono"
              style={{ color: 'var(--ink-dim)' }}
            >
              {formatElapsed(row.elapsedSec ?? 0)}
            </span>

            {/* 채널 */}
            <span className="text-[12.5px]" style={{ color: 'var(--ink-dim)' }}>
              {row.channel || '전화'}
            </span>

            {/* 삭제 — 휴지통: 행을 큐에서 제거. 행 네비게이션으로 버블링 막음.
                시연 보호 행(c-demo-01 등)은 버튼을 아예 렌더하지 않아 삭제 불가. */}
            {UNDELETABLE_CALL_IDS.has(row.callId) ? (
              <span aria-hidden="true" />
            ) : (
              <button
                type="button"
                data-testid={`queue-delete-${row.callId}`}
                aria-label={`${row.customerName ?? row.callId} 큐에서 삭제`}
                title="큐에서 삭제"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(row.callId);
                }}
                onKeyDown={(e) => e.stopPropagation()}
                className="flex-none w-[26px] h-[26px] grid place-items-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 6h18" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            )}
          </div>
          );
        })
      )}
    </div>
  );
}
