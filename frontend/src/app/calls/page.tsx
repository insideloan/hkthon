// AI 상담 화면 진입 랜딩 (/calls) — 사이드바 메뉴로 직접 들어올 때의 화면.
// 데모 시나리오는 관리자 큐 → 세그먼트 → /calls/[id]로 내부 이동하므로 이 경로를
// 쓰지 않는다. 메뉴 클릭 시에는 발신중(DIALING) 큐를 먼저 띄워 어떤 콜로 들어갈지
// 고를 수 있게 한다. 행 클릭 라우팅은 OutboundQueueTable.rowHref가 담당
// (박서준 데모행 → 세그먼트, 체험행 exp-* → 라이브 상담).
'use client';

import { useQueueStore } from '@/stores/queueStore';
import { OutboundQueueTable } from '@/components/queue/OutboundQueueTable';
import type { CallState } from '@/types/queue';

const DIALING: CallState = 'DIALING';

export default function CallsLandingPage() {
  const rows = useQueueStore((s) => s.rows);
  const dialingRows = rows.filter((r) => r.state === DIALING);

  return (
    <main className="w-full p-0">
      {/* ── head ── */}
      <div className="flex items-baseline gap-3 mb-3">
        <h1
          className="font-disp font-[800] text-[22px] tracking-[-0.01em] m-0"
          style={{ color: 'var(--ink)' }}
        >
          AI 상담 화면
        </h1>
        <span
          className="font-mono text-[10px] font-[700] rounded-full px-[10px] py-[3px]"
          style={{
            color: 'var(--route)',
            background: 'var(--badge-bg)',
            border: '1px solid rgba(53,81,214,.25)',
          }}
        >
          발신중 콜 · 상담 진입
        </span>
        <span
          className="ml-auto self-center font-mono text-[11px] font-bold"
          style={{ color: 'var(--ink-faint)' }}
        >
          {dialingRows.length} 건
        </span>
      </div>

      {/* ── table (glass-card shell) ── */}
      <div className="glass-card overflow-hidden" style={{ borderRadius: 16 }}>
        <OutboundQueueTable filteredRows={dialingRows} />
      </div>
    </main>
  );
}
