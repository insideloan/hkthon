// 관리자 대시보드 (/) — SSOT: docs/consult_redesigned-3.html #view-admin.
// stats 카드, 필터 툴바, glass-card 테이블 래퍼.
// 초기 로드 `queue` 쿼리 + 실시간 `onQueueUpdate` 구독은 OutboundQueueTable이 수행.
'use client';

import { useEffect, useState } from 'react';
import { useQueueStore } from '@/stores/queueStore';
import { OutboundQueueTable } from '@/components/queue/OutboundQueueTable';
import { ExperienceModal } from '@/components/queue/ExperienceModal';
import { buildExperienceCustomer, experienceQueueRow, type ExperienceForm } from '@/lib/experience';
import { useExperienceStore } from '@/stores/experienceStore';
import { VadPreloader } from '@/components/VadPreloader';
import type { CallState } from '@/types/queue';

// ─── Filter definition ───────────────────────────────────────────────────────

type FilterKey = 'all' | 'live' | 'wait' | 'done' | 'miss';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'live', label: '상담중' },
  { key: 'wait', label: '대기중' },
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
  unit,
}: {
  label: string;
  value: number | string | null;
  unit?: string;
}) {
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
      <div className="text-[15px] font-bold" style={{ color: 'var(--ink-dim)' }}>
        {label}
      </div>
      <div className="font-disp text-[26px] font-[800] leading-tight mt-[3px]" style={{ color: 'var(--ink)' }}>
        {value ?? 0}
        {unit && (
          <small style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{unit}</small>
        )}
      </div>
    </div>
  );
}

// ─── System clock ─────────────────────────────────────────────────────────────
// 관리자 화면 우상단 시스템 시각 표시. 데모 기준 시각(2026-06-25 14:45:00)에서
// 출발해 실시간으로 흐른다 — 실제 관제 화면처럼 보이도록 초 단위로 틱.

const DEMO_EPOCH = new Date('2026-06-25T14:45:00').getTime();
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function SystemClock() {
  // 마운트 시점부터의 경과를 데모 기준 시각에 더해 표시(SSR/hydration 안전:
  // 최초 렌더는 기준 시각 고정값, 마운트 후 effect 에서 틱 시작).
  const [now, setNow] = useState(() => new Date(DEMO_EPOCH));

  useEffect(() => {
    const start = performance.now();
    const id = window.setInterval(() => {
      setNow(new Date(DEMO_EPOCH + (performance.now() - start)));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const dateText = `${now.getFullYear()}. ${pad(now.getMonth() + 1)}. ${pad(now.getDate())} (${WEEKDAYS[now.getDay()]})`;
  const timeText = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  return (
    <div
      data-testid="admin-datetime"
      className="ml-auto self-center inline-flex items-center gap-2 rounded-[10px] px-3 py-[7px]"
      style={{
        background: 'var(--card)',
        border: '1px solid var(--card-bd)',
        boxShadow: 'var(--shadow)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
      title="시스템 시각"
    >
      {/* 라이브 표시 점 */}
      <span
        aria-hidden
        className="inline-block h-[7px] w-[7px] flex-none rounded-full"
        style={{ background: 'var(--go)', boxShadow: '0 0 0 3px rgba(22,163,74,.18)' }}
      />
      <span className="font-mono text-[13px] font-[700]" style={{ color: 'var(--ink-dim)' }}>
        {dateText}
      </span>
      <span
        className="font-mono text-[15px] font-[800] tabular-nums tracking-[0.01em]"
        style={{ color: 'var(--ink)' }}
      >
        {timeText}
      </span>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Home() {
  const rows = useQueueStore((s) => s.rows);
  const prependRow = useQueueStore((s) => s.prependRow);
  const addExperienceCustomer = useExperienceStore((s) => s.addCustomer);
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [experienceOpen, setExperienceOpen] = useState(false);

  // 체험 모달 확인 — 입력값으로 체험 고객 생성(신용점수/금리 자동 배정) 후 큐
  // 최상단에 발신중(DIALING)으로 노출한다. 데모(mock) 모드라 db 저장은 큐 스토어
  // prepend 로 대체(백엔드 DynamoDB 저장은 후속 작업). 전체 프로필(큐 wire에 못 담는
  // 성별·대출·자산·신용점수·금리)은 experienceStore에 저장 — CRM 상세·라이브 인사말이
  // callId로 조회한다.
  const handleExperienceConfirm = (form: ExperienceForm) => {
    // 고유 시드 — 같은 ms 충돌을 피하려 시각 기반(렌더 외부 이벤트 핸들러라 안전).
    const seed = Date.now();
    const customer = buildExperienceCustomer(form, seed);
    addExperienceCustomer(customer);
    prependRow(experienceQueueRow(customer));
    setActiveFilter('all'); // 새 행이 가려지지 않게 전체 필터로.
    setExperienceOpen(false);
  };

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
      {/* 랜딩 idle 시점에 라이브 상담용 VAD/DNF 에셋(~35MB)을 미리 받아둔다(통화 시작 즉시화). */}
      <VadPreloader />
      {/* ── sum-head ── */}
      <div className="flex items-baseline gap-3 mb-3">
        <h1
          className="font-disp font-[800] text-[22px] tracking-[-0.01em] m-0"
          style={{ color: 'var(--ink)' }}
        >
          상담 모니터링
        </h1>
        <span
          className="font-mono text-[10px] font-[700] rounded-full px-[10px] py-[3px]"
          style={{
            color: 'var(--go)',
            background: 'rgba(22,163,74,.1)',
            border: '1px solid rgba(22,163,74,.25)',
          }}
        >
          전체 상담 모니터링
        </span>
        {/* 날짜·시각 — 체험 버튼 왼쪽. 실시간으로 흐르는 시스템 시각 표시. */}
        <SystemClock />
        {/* 체험 버튼 — 우상단. 클릭 시 고객 정보 입력 팝업. */}
        <button
          type="button"
          data-testid="experience-button"
          onClick={() => setExperienceOpen(true)}
          className="self-center inline-flex items-center gap-1.5 cursor-pointer transition-all duration-[180ms] hover:-translate-y-px"
          style={{
            fontSize: 13, fontWeight: 700, color: '#fff',
            background: 'var(--route)', border: 'none', borderRadius: 10,
            padding: '8px 16px', boxShadow: '0 4px 12px -3px rgba(44,91,214,.5)',
          }}
        >
          <span aria-hidden style={{ fontSize: 14 }}>✦</span>
          체험
        </button>
      </div>

      {/* 체험 고객 입력 모달 */}
      <ExperienceModal
        open={experienceOpen}
        onClose={() => setExperienceOpen(false)}
        onConfirm={handleExperienceConfirm}
      />

      {/* ── adm-stats ── */}
      <div className="grid grid-cols-4 gap-3 mb-4 max-[760px]:grid-cols-2">
        <StatCard label="상담중" value={123} unit="건" />
        <StatCard label="대기중" value={21} unit="건" />
        <StatCard label="대출 접수" value={579} unit="개" />
        <StatCard label="컴플라이언스 준수율" value="99.9" unit="%" />
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
