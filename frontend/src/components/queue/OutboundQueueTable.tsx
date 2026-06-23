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
import { fetchQueue, subscribeQueueUpdates } from '@/lib/appsync';
import { useQueueStore } from '@/stores/queueStore';
import type { CallState, QueueRow } from '@/types/queue';

// Call state → human label (Korean) + badge tone. Mirrors SDL `enum CallState`.
const STATE_LABEL: Record<CallState, string> = {
  CREATED: '대기',
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
  if (highlight === 'needs_agent') return { background: 'rgba(219,83,80,.06)' };
  if (highlight === 'fraud_suspected') return { background: 'rgba(207,138,60,.08)' };
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
//   CREATED          → 사전 고객분석 (/segment) — pre-call analysis screen
//
// The 박서준 demo row carries state DIALING + the 사전 고객분석 stage, so it routes
// to /segment for the scripted analysis → 발신 → 상담 flow. Wire QueueRow has no
// customerId yet (see types/queue.ts), so the segment screen is keyed by the seed
// id mapped from the demo customer name; other customers are wired up later.
const DEMO_NAME_TO_CUSTOMER_ID: Record<string, string> = {
  박서준: 'cust-001',
};

const PRE_ANALYSIS_STAGE = '사전 고객분석';

/** Resolve the target href for a row, or null when the row isn't navigable. */
function rowHref(row: QueueRow): string | null {
  // 사전 고객분석 단계(데모: 박서준) → 세그먼트 분석 화면.
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
const GRID_COLS = '2.2fr 1fr 1.3fr 1.1fr 1.1fr .9fr .8fr';

export function OutboundQueueTable({
  disableLiveData = false,
  filteredRows,
}: OutboundQueueTableProps) {
  const router = useRouter();
  const storeRows = useQueueStore((s) => s.rows);
  const setQueue = useQueueStore((s) => s.setQueue);
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
        <span>상태</span>
        <span>현 단계</span>
        <span>이탈위험</span>
        <span>담당</span>
        <span>통화시간</span>
        <span>채널</span>
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
                style={{ background: 'linear-gradient(135deg,#5168DB,#5B78F0)' }}
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
                  {row.callId}
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
          </div>
          );
        })
      )}
    </div>
  );
}
