// 상담 CRM 진입 랜딩 (/crm) — 사이드바 메뉴로 직접 들어올 때의 화면.
// 데모 시나리오는 상담 종료(✓) → /crm/[id]로 내부 이동하므로 이 경로를 쓰지 않는다.
// 메뉴 클릭 시에는 종료(ENDED) 큐를 먼저 띄워 어떤 상담 요약을 볼지 고를 수 있게 한다.
// 행 클릭 라우팅은 OutboundQueueTable.rowHref가 담당 (ENDED 행 → /crm/[callId]).
'use client';

import { useQueueStore } from '@/stores/queueStore';
import { OutboundQueueTable } from '@/components/queue/OutboundQueueTable';
import type { CallState } from '@/types/queue';

const ENDED: CallState = 'ENDED';

export default function CrmLandingPage() {
  const rows = useQueueStore((s) => s.rows);
  const endedRows = rows.filter((r) => r.state === ENDED);

  return (
    <main className="w-full p-0">
      {/* ── head ── */}
      <div className="flex items-baseline gap-3 mb-3">
        <h1
          className="font-disp font-[800] text-[22px] tracking-[-0.01em] m-0"
          style={{ color: 'var(--ink)' }}
        >
          상담 CRM
        </h1>
        <span
          className="font-mono text-[10px] font-[700] rounded-full px-[10px] py-[3px]"
          style={{
            color: 'var(--go)',
            background: 'rgba(22,163,74,.1)',
            border: '1px solid rgba(22,163,74,.25)',
          }}
        >
          종료 콜 · 상담 요약
        </span>
        <span
          className="ml-auto self-center font-mono text-[11px] font-bold"
          style={{ color: 'var(--ink-faint)' }}
        >
          {endedRows.length} 건
        </span>
      </div>

      {/* ── table (glass-card shell) ── */}
      <div className="glass-card overflow-hidden" style={{ borderRadius: 16 }}>
        <OutboundQueueTable filteredRows={endedRows} />
      </div>
    </main>
  );
}
