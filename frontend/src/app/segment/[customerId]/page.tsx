// 사전 고객분석 화면 — FRONTEND-003 / #32.
// 진입 시 createCall(customerId) 뮤테이션으로 분석 전용 콜 생성 (발신 아님).
// customer 쿼리로 고객 정보 로드. 분석 완료 후 FRONTEND-002 CallButton 렌더.
// 디자인 SSOT: docs/consult_redesigned-3.html #view-segment (세그먼트 분류 SVG + dial box)
'use client';

import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { createCall, fetchCustomer } from '@/lib/appsync';
import { CallButton } from '@/components/consult/CallButton';
import type { Customer } from '@/lib/appsync';

type AnalysisPhase = 'loading' | 'analysing' | 'complete' | 'error';

type SegmentPageProps = {
  params: { customerId: string };
};

export default function SegmentPage({ params }: SegmentPageProps) {
  const { customerId } = params;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [phase, setPhase] = useState<AnalysisPhase>('loading');
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [counter, setCounter] = useState(0);

  // 1) 고객 정보 로드 + createCall 뮤테이션 (분석 전용, 발신 아님)
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [cust, call] = await Promise.all([
          fetchCustomer(customerId),
          createCall(customerId),
        ]);
        if (cancelled) return;
        setCustomer(cust);
        setCallId(call.callId);
        setPhase('analysing');
      } catch (err) {
        console.error('사전 분석 초기화 오류', err);
        if (!cancelled) setPhase('error');
      }
    }
    init();
    return () => { cancelled = true; };
  }, [customerId]);

  // 2) 분석 카운터 시뮬레이션 (analysing → complete)
  useEffect(() => {
    if (phase !== 'analysing') return;
    const TOTAL = 12;
    let tick = 0;
    const timer = setInterval(() => {
      tick += 1;
      setCounter(tick);
      if (tick >= TOTAL) {
        clearInterval(timer);
        setPhase('complete');
        setAnalysisComplete(true);
      }
    }, 150);
    return () => clearInterval(timer);
  }, [phase]);

  const initials = customer?.name ? customer.name[0] : '?';

  return (
    <section
      id="view-segment"
      className="relative min-h-screen bg-bg p-4"
      data-testid="segment-page"
      data-phase={phase}
    >
      <div className="sg-wrap mx-auto max-w-[760px]">

        {/* 상단: 고객 정보 + 분석 상태 */}
        <div className="sg-top mb-[14px] flex items-center gap-3">
          <div
            className="ava grid h-[42px] w-[42px] flex-none place-items-center rounded-full bg-gradient-to-br from-[#5168DB] to-[#5B78F0] text-base font-extrabold text-white shadow-[0_6px_16px_-8px_rgba(53,81,214,.6)]"
            aria-hidden
          >
            {initials}
          </div>
          <div className="tx flex min-w-0 flex-col leading-[1.3]">
            <h1 className="m-0 font-display text-xl font-extrabold tracking-[-0.01em] text-ink">
              {customer?.name ?? '–'}
              {customer?.age != null && (
                <span className="age ml-1 text-[13px] font-semibold text-ink-dim">
                  ({customer.age}세)
                </span>
              )}
            </h1>
            <span className="sub text-xs font-semibold text-ink-faint">
              {customer?.targetProduct ?? '상품 확인 중'}
            </span>
          </div>

          {/* 분석 중 스피너 배지 */}
          {phase === 'analysing' && (
            <div
              className="status-pre ml-auto inline-flex flex-none items-center gap-2 rounded-full border border-[rgba(107,79,184,.32)] bg-[rgba(107,79,184,.12)] px-[14px] py-[7px] font-display text-[13px] font-bold text-purple"
              data-testid="analysis-status"
            >
              <span className="sp-spin h-[13px] w-[13px] animate-spin rounded-full border-2 border-[rgba(107,79,184,.3)] border-t-purple" aria-hidden />
              세그먼트 분석 중
              <span className="sdots inline-flex w-[14px]">
                <i className="not-italic opacity-0 [animation:sgblink_1.4s_infinite]">.</i>
                <i className="not-italic opacity-0 [animation:sgblink_1.4s_infinite_200ms]">.</i>
                <i className="not-italic opacity-0 [animation:sgblink_1.4s_infinite_400ms]">.</i>
              </span>
            </div>
          )}
          {phase === 'complete' && (
            <div
              className="status-pre ml-auto inline-flex flex-none items-center gap-2 rounded-full border border-[rgba(107,79,184,.32)] bg-[rgba(107,79,184,.12)] px-[14px] py-[7px] font-display text-[13px] font-bold text-purple"
              data-testid="analysis-complete-badge"
            >
              ✓ 분석 완료
            </div>
          )}
        </div>

        {/* 분석 카운터 */}
        <div className="sg-counter glass mb-[13px] flex flex-col items-center gap-[3px] rounded-[18px] border border-card-bd bg-card px-0 py-[16px] pb-[14px] backdrop-blur-[16px]">
          <span className="sg-clbl text-[11.5px] font-semibold text-ink-faint">분석 데이터 포인트</span>
          <span
            className={clsx(
              'sg-cnum font-mono text-[32px] font-bold tabular-nums',
              analysisComplete ? 'text-route' : 'text-ink',
            )}
            data-testid="analysis-counter"
          >
            {analysisComplete ? '완료' : counter.toString().padStart(2, '0')}
          </span>
        </div>

        {/* 세그먼트 분류 SVG (SSOT #view-segment 내 SVG 레이아웃) */}
        <div
          className="glass rounded-[18px] border border-card-bd bg-card p-4 backdrop-blur-[16px]"
          data-testid="segment-viz"
        >
          <svg
            viewBox="0 0 680 260"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full"
            aria-label="세그먼트 군집 분류 시각화"
          >
            {/* 카테고리 레이블 */}
            <g className={clsx('cat', phase !== 'loading' && 'show')} data-testid="sg-categories">
              <text x="60" y="24" className="ts" textAnchor="middle">금리민감도</text>
              <text x="340" y="24" className="ts" textAnchor="middle">자산보유형</text>
              <text x="620" y="24" className="ts" textAnchor="middle">신규유입형</text>
            </g>
            {/* 클러스터 박스 */}
            <g className={clsx('clu box', phase !== 'loading' && 'show')}>
              <rect x="10" y="35" width="100" height="60" rx="10" />
              <text x="60" y="60" className="ts" textAnchor="middle">대환대출</text>
              <text x="60" y="80" className="th" textAnchor="middle">38%</text>
            </g>
            <g className={clsx('clu box c-blue', phase !== 'loading' && 'show')} style={{ transitionDelay: '0.1s' }}>
              <rect x="290" y="35" width="100" height="60" rx="10" />
              <text x="340" y="60" className="ts" textAnchor="middle">자동차담보</text>
              <text x="340" y="80" className="th" textAnchor="middle">71%</text>
            </g>
            <g className={clsx('clu box', phase !== 'loading' && 'show')} style={{ transitionDelay: '0.2s' }}>
              <rect x="570" y="35" width="100" height="60" rx="10" />
              <text x="620" y="60" className="ts" textAnchor="middle">신용대출</text>
              <text x="620" y="80" className="th" textAnchor="middle">22%</text>
            </g>
            {/* 연결선 */}
            <line
              className={clsx('ln', analysisComplete && 'show')}
              x1="110" y1="65" x2="290" y2="65"
              stroke="var(--route)" strokeWidth="1.5" strokeDasharray="1" pathLength="1"
            />
            <line
              className={clsx('ln', analysisComplete && 'show')}
              x1="390" y1="65" x2="570" y2="65"
              stroke="var(--hair)" strokeWidth="1.5" strokeDasharray="1" pathLength="1"
            />
            {/* 고객 세그먼트 도트 */}
            {analysisComplete && (
              <g className="seg show lock" data-testid="customer-segment-dot">
                <circle cx="340" cy="170" r="10" fill="var(--route)" />
                <text x="340" y="200" className="th" textAnchor="middle" fill="var(--route)">
                  {customer?.name ?? '고객'}
                </text>
                <text x="340" y="218" className="ts" textAnchor="middle">자산보유형 · HIGH</text>
              </g>
            )}
          </svg>
        </div>

        {/* 분석 완료 후 — 전략 정보 + 통화 버튼 */}
        {analysisComplete && (
          <div className="sg-final show mt-[14px] flex flex-col gap-3" data-testid="analysis-final">
            <div className="glass sg-sec rounded-[18px] border border-card-bd bg-card px-[17px] py-[15px]">
              <span className="sg-tag t2 mb-[11px] inline-block rounded-full bg-badge-bg px-[10px] py-[3px] font-mono text-[10px] font-bold uppercase tracking-[.08em] text-route">
                추천 상품
              </span>
              <div className="strat-card flex flex-col">
                <div className="strat-mod py-[4px]">
                  <div className="strat-mod-h mb-[13px] flex items-center gap-2 font-display text-sm font-extrabold text-ink">
                    <i className="text-[19px] text-route" aria-hidden>💡</i>
                    자동차 담보대출
                  </div>
                  <div className="flow-row flex flex-wrap items-center gap-[10px]">
                    <span className="flow-chip muted rounded-[11px] border border-hair bg-white/50 px-[13px] py-[7px] text-[13px] font-bold text-ink-faint line-through">
                      신용대출
                    </span>
                    <span className="flow-ar text-lg text-ink-faint">→</span>
                    <span className="flow-chip strong rounded-[11px] border border-route bg-route px-[16px] py-[9px] text-base font-bold text-white shadow-[0_6px_16px_-8px_rgba(53,81,214,.6)]">
                      자동차 담보대출
                    </span>
                  </div>
                  <div className="flow-sub mt-3 text-[12.5px] leading-[1.55] text-ink-dim">
                    보유 <b className="font-bold text-ink">실물자산(차량)</b> 활용 · 상품 반응도{' '}
                    <b className="hi font-bold text-route">HIGH</b>
                  </div>
                </div>
              </div>
            </div>

            {/* 발신하기 버튼 (CallButton from FRONTEND-002) */}
            <div className="sg-btnwrap flex justify-center gap-[10px]" data-testid="call-button-wrapper">
              {callId && (
                <CallButton callId={callId} analysisComplete={analysisComplete} />
              )}
            </div>
          </div>
        )}

        {/* 에러 상태 */}
        {phase === 'error' && (
          <div className="mt-4 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger" data-testid="segment-error">
            분석 초기화 중 오류가 발생했습니다. 새로고침 후 다시 시도해주세요.
          </div>
        )}
      </div>
    </section>
  );
}
