// 관리자 대시보드 (/) — SSOT: docs/consult_redesigned-3.html #view-admin.
// stats 카드, 필터 툴바, glass-card 테이블 래퍼.
// 초기 로드 `queue` 쿼리 + 실시간 `onQueueUpdate` 구독은 OutboundQueueTable이 수행.
'use client';

import { useState } from 'react';
import { useQueueStore } from '@/stores/queueStore';
import { OutboundQueueTable } from '@/components/queue/OutboundQueueTable';
import type { CallState } from '@/types/queue';

// ─── Filter definition ───────────────────────────────────────────────────────

type FilterKey = 'all' | 'live' | 'wait' | 'done' | 'miss';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'live', label: '상담중' },
  { key: 'wait', label: '대기' },
  { key: 'done', label: '완료' },
  { key: 'miss', label: '이탈' },
];

/** States considered "live" (IN_CALL / TRANSFER_PENDING). */
const LIVE_STATES = new Set<CallState>(['IN_CALL', 'TRANSFER_PENDING']);
/** States considered "waiting" (CREATED / DIALING). */
const WAIT_STATES = new Set<CallState>(['CREATED', 'DIALING']);

// ─── Stat card ───────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  accent,
  unit,
}: {
  label: string;
  value: number | string | null;
  accent?: 'live' | 'miss' | 'done' | 'warn' | undefined;
  unit?: string;
}) {
  const valueColor =
    accent === 'live' ? 'text-[var(--route)]'
    : accent === 'miss' ? 'text-[var(--danger)]'
    : accent === 'done' ? 'text-[var(--go)]'
    : accent === 'warn' ? 'text-[var(--hazard-ink)]'
    : 'text-[var(--ink)]';

  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--card-bd)',
        borderRadius: 14,
        padding: '12px 15px',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        boxShadow: 'var(--shadow)',
      }}
    >
      <div className="text-[11px] font-bold" style={{ color: 'var(--ink-faint)' }}>
        {label}
      </div>
      <div className={`font-disp text-[26px] font-[800] leading-tight mt-[3px] ${valueColor}`}>
        {value ?? 0}
        {unit && (
          <small style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-dim)' }}>{unit}</small>
        )}
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Home() {
  const rows = useQueueStore((s) => s.rows);
  const summary = useQueueStore((s) => s.summary);
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');

  // Derived counts from rows (SDL summary = total/needsAgent/fraudSuspected/inCall;
  // ended/waiting are display-only, computed client-side from row states).
  const totalCalls = summary?.total ?? rows.length;
  const endedCount = rows.filter((r) => r.state === 'ENDED').length;
  const liveCount =
    summary?.inCall ?? rows.filter((r) => LIVE_STATES.has(r.state as CallState)).length;
  const completionRate = totalCalls > 0 ? (endedCount / totalCalls) * 100 : 0;
  const completionRateDisplay = completionRate.toFixed(1);

  // Compute filtered rows for the count badge and table
  const filteredRows = rows.filter((row) => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'live') return row.state ? LIVE_STATES.has(row.state) : false;
    if (activeFilter === 'wait') return row.state ? WAIT_STATES.has(row.state) : false;
    if (activeFilter === 'done') return row.state === 'ENDED';
    if (activeFilter === 'miss') return row.highlight === 'needs_agent' || row.highlight === 'fraud_suspected';
    return true;
  });

  return (
    <main className="w-full p-0">
      {/* ── sum-head ── */}
      <div className="flex items-baseline gap-3 mb-3">
        <h1
          className="font-disp font-[800] text-[22px] tracking-[-0.01em] m-0"
          style={{ color: 'var(--ink)' }}
        >
          관리자 화면 · 콜 리스트
        </h1>
        <span
          className="font-mono text-[10px] font-[700] rounded-full px-[10px] py-[3px]"
          style={{
            color: 'var(--go)',
            background: 'rgba(107,74,42,.12)',
            border: '1px solid rgba(107,74,42,.3)',
          }}
        >
          전체 상담 모니터링
        </span>
      </div>

      {/* ── adm-stats ── */}
      <div className="grid grid-cols-4 gap-3 mb-4 max-[760px]:grid-cols-2">
        <StatCard label="현재 진행 중인 콜" value={liveCount} accent="live" />
        <StatCard label="대기 중 상담원" value={2} />
        <StatCard label="오늘 상담사 연결" value={endedCount} unit="건" accent="done" />
        <StatCard label="컴플라이언스 준수율" value={completionRateDisplay} unit="%" accent="done" />
      </div>

      {/* ── adm-toolbar ── */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex gap-[6px]">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveFilter(key)}
              className="text-[12px] font-bold rounded-full px-[14px] py-[6px] cursor-pointer transition-all duration-[180ms] border"
              style={
                activeFilter === key
                  ? {
                      color: '#fff',
                      background: 'var(--route)',
                      borderColor: 'var(--route)',
                    }
                  : {
                      color: 'var(--ink-dim)',
                      background: 'rgba(255,255,255,.5)',
                      borderColor: 'var(--card-bd)',
                    }
              }
            >
              {label}
            </button>
          ))}
        </div>
        <span
          className="ml-auto font-mono text-[11px] font-bold"
          style={{ color: 'var(--ink-faint)' }}
        >
          {filteredRows.length} / {rows.length} 건
        </span>
      </div>

      {/* ── adm-table (glass-card shell) ── */}
      <div className="glass-card overflow-hidden" style={{ borderRadius: 16 }}>
        <OutboundQueueTable filteredRows={filteredRows} />
      </div>
    </main>
  );
}
