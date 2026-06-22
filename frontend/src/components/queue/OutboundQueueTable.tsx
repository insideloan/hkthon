// OutboundQueueTable — admin dashboard call list (FRONTEND-001 / #30).
// Initial load: `queue` query; realtime: `onQueueUpdate` subscription (lib/appsync.ts).
// Consumes the queue store; styling only via ui/* wrappers (CONVENTIONS.md §6.1).
'use client';

import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { RiskBar } from '@/components/ui/RiskBar';
import { fetchQueue, subscribeQueueUpdates } from '@/lib/appsync';
import { useQueueStore } from '@/stores/queueStore';
import type { CallState, QueueRow } from '@/types/queue';

// Call state → human label (Korean) + badge tone. reference/API.md state machine.
const STATE_LABEL: Record<CallState, string> = {
  DIALING: '발신중',
  RINGING: '연결중',
  ACCEPTED: '수락',
  REJECTED: '거절',
  IN_CALL: '통화중',
  TRANSFER_PENDING: '상담원 연결 대기',
  AGENT_JOINED: '상담원 연결됨',
  ENDED: '종료',
};

const STATE_TONE: Record<CallState, BadgeTone> = {
  DIALING: 'noanswer',
  RINGING: 'noanswer',
  ACCEPTED: 'active',
  REJECTED: 'rejected',
  IN_CALL: 'active',
  TRANSFER_PENDING: 'escalate',
  AGENT_JOINED: 'signup',
  ENDED: 'neutral',
};

/** Map a row's highlight flag to row emphasis. */
function rowHighlightClass(highlight: QueueRow['highlight']): string {
  if (highlight === 'needs_agent') return 'bg-red-50 hover:bg-red-100';
  if (highlight === 'fraud_suspected') return 'bg-amber-50 hover:bg-amber-100';
  return 'hover:bg-[rgba(53,81,214,0.06)]';
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** First character of customer name, used as avatar initial. */
function nameInitial(name: string): string {
  return name.charAt(0) || '?';
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
        rows.map((row) => (
          <div
            key={row.callId}
            data-testid={`queue-row-${row.callId}`}
            data-highlight={row.highlight ?? 'none'}
            className={clsx(
              'grid gap-[10px] items-center px-4 py-[11px] transition-colors cursor-default',
              'border-b last:border-b-0',
              rowHighlightClass(row.highlight),
            )}
            style={{
              gridTemplateColumns: GRID_COLS,
              borderColor: 'var(--hair)',
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
                  className="text-[13.5px] font-[800] truncate"
                  style={{ color: 'var(--ink)' }}
                >
                  {row.customerName}
                </span>
                <span className="text-[10.5px] truncate" style={{ color: 'var(--ink-dim)' }}>
                  {row.targetProduct || row.customerId}
                </span>
              </div>
            </div>

            {/* 상태 badge */}
            <div>
              <Badge tone={STATE_TONE[row.state]}>{STATE_LABEL[row.state]}</Badge>
            </div>

            {/* 현 단계 */}
            <span className="text-[12.5px] font-bold truncate" style={{ color: 'var(--ink)' }}>
              {row.scenario}
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
              {row.highlight === 'needs_agent' ? '상담원' : 'AI'}
            </span>

            {/* 통화시간 */}
            <span
              className="text-[12.5px] tabular-nums font-mono"
              style={{ color: 'var(--ink-dim)' }}
            >
              {formatElapsed(row.elapsedSec)}
            </span>

            {/* 채널 */}
            <span className="text-[12.5px]" style={{ color: 'var(--ink-dim)' }}>
              {row.scenario}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
