'use client';

// CRM 상담 요약 페이지 — SSOT: docs/consult_redesigned-3.html #view-summary (lines 1138-1190)
// Next.js 15: params는 Promise — React use()로 언래핑.
//
// 프로필/니즈/권장액션은 클릭한 큐 레코드(callId)별로 구성한다(lib/customerProfiles).
// 큐 스토어에 해당 행이 있으면 신원을 실제 레코드로 보정하고, 없으면(직접 로드)
// fixture만으로도 동작한다. 상담 흐름(ConsultFlow)·대기 상담사 목록은 공용 데모.

import { use } from 'react';
import { ConsultFlow } from '@/components/crm/ConsultFlow';
import { useQueueStore } from '@/stores/queueStore';
import { useExperienceStore } from '@/stores/experienceStore';
import { resolveCustomerProfile } from '@/lib/customerProfiles';

// ── 정적 목 데이터 ─────────────────────────────────────────────────────────────
const MOCK_AGENTS = [
  {
    id: 'a1',
    name: '김지수',
    init: '김',
    status: '즉시 가능',
    statusOk: true,
    skill: '주택담보',
    exp: '7년',
    rate: '92%',
    wait: '즉시 가능',
  },
  {
    id: 'a2',
    name: '이태우',
    init: '이',
    status: '즉시 가능',
    statusOk: true,
    skill: '금리협상',
    exp: '5년',
    rate: '88%',
    wait: '즉시 가능',
  },
  {
    id: 'a3',
    name: '박현아',
    init: '박',
    status: '곧 가능',
    statusOk: false,
    skill: '신용대출',
    exp: '4년',
    rate: '85%',
    wait: '3분 후',
  },
];

// ── SVG 아이콘 모음 ───────────────────────────────────────────────────────────
function IconUser() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-[18px] h-[18px]">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconFlow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-[18px] h-[18px]">
      <path
        d="M4 18l5-5 4 3 6-7"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15 9h4v4"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-[18px] h-[18px]">
      <path
        d="M5 12l4 4 10-10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconAgents() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-[18px] h-[18px]">
      <circle cx="9" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M2.5 20c0-3.6 3-6 6.5-6s6.5 2.4 6.5 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M17 4.5a3.2 3.2 0 0 1 0 6.4M19 20c0-2.6-1-4.6-3-5.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── 카드 헤더 ─────────────────────────────────────────────────────────────────
function CardHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-[9px] mb-[11px]">
      <span className="flex items-center justify-center w-[28px] h-[28px] rounded-[8px] bg-[var(--badge-bg)] text-[var(--route)]">
        {icon}
      </span>
      <h2 className="font-disp text-[14.5px] font-extrabold m-0 text-[var(--title)]">{title}</h2>
    </div>
  );
}

// ── 메인 페이지 컴포넌트 ──────────────────────────────────────────────────────
export default function CrmDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  // 클릭한 큐 레코드(callId)별 프로필. 체험 고객(exp-*)은 입력값 전체 프로필을 쓰고,
  // 그 외는 큐 행 신원으로 보정한 데모 fixture/폴백을 쓴다.
  const row = useQueueStore((s) => s.rows.find((r) => r.callId === id));
  const experience = useExperienceStore((s) => s.customers[id]);
  const profile = resolveCustomerProfile(id, row, experience);

  // 프로필 KV — 고객 신원 + 금융 프로필을 레코드별로 구성.
  const profileKv = [
    { label: '고객', value: `${profile.name} · ${profile.genderAge}`, variant: '' },
    { label: '신용점수', value: profile.kcb, variant: '' },
    { label: '보유 대출', value: profile.loan, variant: '' },
    { label: profile.rateLabel ?? '현 금리', value: profile.rate, variant: profile.rateVariant },
    { label: '자산', value: profile.asset, variant: '' },
    { label: '이탈 위험', value: profile.churnLabel, variant: profile.churnVariant },
  ];

  return (
    <main className="p-6 min-h-screen" data-testid="crm-page">
      {/* .sum-head */}
      <div className="flex items-baseline gap-3 mx-0.5 mb-3">
        <h1 className="font-disp text-[22px] font-extrabold tracking-[-0.01em] m-0 text-[var(--ink)]">
          상담 CRM
        </h1>
        <span className="font-mono text-[10px] font-bold text-[var(--go)] bg-[rgba(22,163,74,0.1)] border border-[rgba(22,163,74,0.25)] rounded-full px-2.5 py-[3px]">
          AI 상담 종료 · 상담사 연결 대기
        </span>
      </div>

      {/* .sum-grid — 2-column layout */}
      <div className="grid grid-cols-[1.6fr_1fr] gap-[14px] items-start max-[980px]:grid-cols-1">

        {/* 좌: .sum-main */}
        <div>
          {/* 카드 1: 고객 프로필 */}
          <div className="glass-card p-[14px_16px] mb-[14px]" data-testid="profile-card">
            <CardHeader icon={<IconUser />} title="고객 프로필" />
            {/* .sum-kv */}
            <div className="grid grid-cols-2 gap-[8px_18px]">
              {profileKv.map(({ label, value, variant }) => (
                <div
                  key={label}
                  className="flex flex-col gap-[1px] border-b border-dashed border-[var(--hair)] pb-[6px]"
                >
                  <dt className="text-[10px] font-bold text-[var(--ink-faint)] m-0">{label}</dt>
                  <dd
                    className={[
                      'text-[13px] font-bold m-0',
                      variant === 'hot' ? 'text-[var(--danger)]' : '',
                      variant === 'ok' ? 'text-[var(--go)]' : '',
                      variant === '' ? 'text-[var(--ink)]' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </div>
          </div>

          {/* 카드 2: 상담 흐름 요약 (ConsultFlow) */}
          <div className="glass-card p-[14px_16px] mb-[14px]" data-testid="flow-card">
            <CardHeader icon={<IconFlow />} title="상담 흐름 요약" />
            <ConsultFlow callId={id} disableLiveData initialMots={[]} />
          </div>

          {/* 카드 3: 핵심 니즈 · 다음 액션 */}
          <div className="glass-card p-[14px_16px] mb-[14px]" data-testid="needs-card">
            <CardHeader icon={<IconCheck />} title="핵심 니즈 · 다음 액션" />
            {/* .sum-chips */}
            <div className="flex flex-wrap gap-[6px]">
              {profile.needs.map(({ label, variant }) => (
                <span
                  key={label}
                  className={[
                    'text-xs font-bold rounded-full px-[11px] py-[4px]',
                    variant === 'warn'
                      ? 'text-[var(--hazard-ink)] bg-[rgba(217,119,6,0.12)]'
                      : variant === 'ok'
                        ? 'text-[var(--go)] bg-[rgba(22,163,74,0.1)]'
                        : 'text-[var(--route)] bg-[var(--badge-bg)]',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {label}
                </span>
              ))}
            </div>
            {/* .sum-next */}
            <div className="mt-[11px] text-[12.5px] leading-[1.55] text-[var(--ink)] bg-[rgba(37,99,235,0.06)] border-l-[3px] border-[var(--route)] rounded-[0_8px_8px_0] px-[12px] py-[9px]">
              ▶ 권장:{' '}
              <b className="text-[var(--route)]">{profile.nextAction}</b>
            </div>
          </div>
        </div>

        {/* 우: .sum-side */}
        <div>
          {/* 카드: 대기 중 상담사 */}
          <div className="glass-card p-[14px_16px]" data-testid="agents-card">
            <CardHeader icon={<IconAgents />} title="대기 중 상담사" />
            {/* .agent-list */}
            <div className="flex flex-col gap-[9px]">
              {MOCK_AGENTS.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center gap-[11px] border border-[var(--card-bd)] rounded-[13px] bg-[rgba(255,255,255,0.5)] px-[12px] py-[10px]"
                  data-testid="agent-item"
                >
                  {/* .av — circular gradient avatar */}
                  <span
                    className="flex-none flex items-center justify-center w-[40px] h-[40px] rounded-full text-white font-extrabold text-[15px]"
                    style={{ background: 'linear-gradient(135deg,#2563eb,#4d7cf0)' }}
                    aria-hidden
                  >
                    {agent.init}
                  </span>
                  {/* .info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-[7px]">
                      <span className="text-[13.5px] font-extrabold text-[var(--ink)]">{agent.name}</span>
                      <span
                        className={[
                          'font-mono text-[8.5px] font-bold rounded-full px-[7px] py-[1px]',
                          agent.statusOk
                            ? 'text-[var(--go)] bg-[rgba(22,163,74,0.1)]'
                            : 'text-[var(--hazard-ink)] bg-[rgba(217,119,6,0.12)]',
                        ].join(' ')}
                      >
                        {agent.status}
                      </span>
                    </div>
                    {/* .meta */}
                    <div className="text-[11px] text-[var(--ink-dim)] mt-[2px]">
                      {agent.skill} · {agent.exp} ·{' '}
                      <b className="text-[var(--route)]">{agent.rate}</b> · {agent.wait}
                    </div>
                  </div>
                  {/* .pick button */}
                  <button
                    className="flex-none font-disp text-[11.5px] font-bold text-white rounded-[9px] px-[12px] py-[7px] disabled:cursor-default shadow-[0_4px_12px_-3px_rgba(44,91,214,0.5)]"
                    style={agent.statusOk ? { background: 'var(--route)' } : { background: '#cbd0d8' }}
                    disabled={!agent.statusOk}
                    data-testid="agent-pick"
                  >
                    연결
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
