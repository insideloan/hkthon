// 사전 고객분석 화면 — FRONTEND-003 / #32.
// 진입 시 createCall(customerId) 뮤테이션으로 분석 전용 콜 생성 (발신 아님).
// customer 쿼리로 고객 정보 로드. 분석 완료 후 FRONTEND-002 CallButton 렌더.
// 디자인 SSOT: docs/consult_redesigned-3.html #view-segment (세그먼트 분류 SVG + dial box)
'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { createCall, fetchCustomer } from '@/lib/appsync';
import { CallButton } from '@/components/consult/CallButton';
import type { Customer } from '@/lib/appsync';

type AnalysisPhase = 'loading' | 'analysing' | 'complete' | 'error';

// Next.js 15: 동적 라우트 params는 Promise — client component에서 use()로 언래핑.
type SegmentPageProps = {
  params: Promise<{ customerId: string }>;
};

const COMBO_START = 16_777_216;

function formatCombo(n: number): string {
  return n.toLocaleString('en-US');
}

export default function SegmentPage({ params }: SegmentPageProps) {
  const { customerId } = use(params);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [phase, setPhase] = useState<AnalysisPhase>('loading');
  // analysisComplete 만 React 상태 — 전략 카드/발신 버튼 mount 토글용. SVG 진입
  // 연출은 React 재렌더 없이 ref+classList+rAF 로 직접 구동한다 (SSOT 방식). 12회
  // setState 로 거대한 SVG 를 재렌더하면 CSS transition 이 끊겨 애니메이션이 튐.
  const [analysisComplete, setAnalysisComplete] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const comboRef = useRef<HTMLSpanElement | null>(null);
  // 진행 중인 타임라인 정리 핸들 (setTimeout id + rAF id). replay/unmount 시 취소.
  const animRef = useRef<{ timers: number[]; raf: number }>({ timers: [], raf: 0 });

  // ── 분석 연출 타임라인 (명령형) ───────────────────────────────────────────
  // 원천데이터 cascade → 군집·연결선 A~D 순차 draw → 세그먼트 후보 → 조합·선택
  // 잠금. combo 숫자는 rAF 로 부드럽게 감소. 모두 DOM 직접 조작이라 재렌더 없음.
  const runAnimation = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // 이전 타임라인 취소 + 초기 상태로 리셋.
    animRef.current.timers.forEach((t) => clearTimeout(t));
    cancelAnimationFrame(animRef.current.raf);
    animRef.current = { timers: [], raf: 0 };
    setAnalysisComplete(false);
    // 리셋 시 transition 을 잠시 꺼 즉시 숨김 → fade-out 깜빡임 방지 (replay).
    // 강제 reflow 후 다시 켜야 이후 .show 가 정상적으로 transition 된다.
    svg.classList.add('sg-reset');
    svg.querySelectorAll('.show, .dim, .lock').forEach((el) =>
      el.classList.remove('show', 'dim', 'lock'),
    );
    void svg.getBoundingClientRect(); // reflow flush
    svg.classList.remove('sg-reset');

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const show = (sel: string) =>
      svg.querySelectorAll(sel).forEach((el) => el.classList.add('show'));
    const at = (ms: number, fn: () => void) => {
      animRef.current.timers.push(window.setTimeout(fn, reduce ? 0 : ms));
    };

    // combo 카운터: from→to 를 dur 동안 ease 로 보간 (rAF).
    const countTo = (to: number, dur: number) => {
      const node = comboRef.current;
      if (!node) return;
      const from = parseInt((node.textContent || '0').replace(/[^0-9]/g, ''), 10) || 0;
      if (reduce) { node.textContent = to.toLocaleString('en-US'); return; }
      const start = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / dur);
        const e = k * k * (3 - 2 * k); // smoothstep
        node.textContent = Math.round(from + (to - from) * e).toLocaleString('en-US');
        if (k < 1) animRef.current.raf = requestAnimationFrame(step);
      };
      animRef.current.raf = requestAnimationFrame(step);
    };

    if (comboRef.current) comboRef.current.textContent = formatCombo(COMBO_START);

    // 원천 데이터 9행 — CSS data-i stagger 가 시차를 담당, 그룹만 show.
    show('.cat');
    // 군집 + 연결선 A~D 순차 등장 + combo 단계 감소.
    at(450, () => { show('.ln-A'); show(".clu[data-c='A']"); countTo(262_144, 900); });
    at(900, () => { show('.ln-B'); show(".clu[data-c='B']"); countTo(4_096, 900); });
    at(1350, () => { show('.ln-C'); show(".clu[data-c='C']"); countTo(64, 900); });
    at(1800, () => { show('.ln-D'); show(".clu[data-c='D']"); countTo(4, 900); });
    // 세그먼트 후보 등장.
    at(2250, () => { show(".seg[data-s='top']"); show(".seg[data-s='bottom']"); });
    // 조합 → 선택 세그먼트 잠금 + 비선택 dim + 최종 연결선.
    at(2700, () => {
      show('.ln-cv'); show(".clu[data-c='cv']"); countTo(1, 600);
    });
    at(3200, () => {
      show('.ln-sg');
      svg.querySelector(".seg[data-s='top']")?.classList.add('dim');
      svg.querySelector(".seg[data-s='bottom']")?.classList.add('dim');
      const sel = svg.querySelector(".seg[data-s='sel']");
      sel?.classList.add('show', 'lock');
      comboRef.current?.classList.add('done');
    });
    at(3500, () => {
      setAnalysisComplete(true); // 전략 카드 + 발신 버튼 노출
      setPhase('complete');
    });
  }, []);

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

  // 2) analysing 진입 시 타임라인 1회 구동. unmount 시 진행 중 타이머/ rAF 정리.
  useEffect(() => {
    if (phase !== 'analysing') return;
    runAnimation();
    const anim = animRef.current;
    return () => {
      anim.timers.forEach((t) => clearTimeout(t));
      cancelAnimationFrame(anim.raf);
    };
  }, [phase, runAnimation]);

  const initials = customer?.name ? customer.name[0] : '?';

  return (
    <section
      id="view-segment"
      className="relative min-h-screen p-4"
      data-testid="segment-page"
      data-phase={phase}
    >
      <div className="sg-wrap mx-auto max-w-[760px]">

        {/* 상단: 고객 정보 + 분석 상태 */}
        <div className="sg-top mb-[14px] flex items-center gap-3">
          <div
            className="ava grid h-[42px] w-[42px] flex-none place-items-center rounded-full bg-gradient-to-br from-route to-route-2 text-base font-extrabold text-white shadow-[0_6px_16px_-8px_rgba(53,81,214,.6)]"
            aria-hidden
          >
            {initials}
          </div>
          <div className="tx flex min-w-0 flex-col leading-[1.3]">
            <h1 className="m-0 font-disp text-xl font-extrabold tracking-[-0.01em] text-ink">
              {customer?.name ?? '–'}
              {customer?.age != null && (
                <span className="age ml-1 text-[13px] font-semibold text-ink-dim">
                  · {'남'} · {customer.age}세 · KCB {'744'}
                </span>
              )}
            </h1>
            {/* Fix #7: Fixed subtitle text '고객 세그먼트 분류' */}
            <span className="sub text-xs font-semibold text-ink-faint">
              고객 세그먼트 분류
              {customer?.targetProduct && (
                <> · <span data-testid="target-product">{customer.targetProduct}</span></>
              )}
            </span>
          </div>

          {/* Fix #4: status-pre badge — purple color scheme */}
          {phase === 'analysing' && (
            <div
              className="status-pre ml-auto inline-flex flex-none items-center gap-2 rounded-full border border-[rgba(107,79,184,.32)] bg-[rgba(107,79,184,.12)] px-[14px] py-[7px] font-disp text-[13px] font-bold text-[#6B4FB8]"
              data-testid="analysis-status"
            >
              <span
                className="sp-spin h-[13px] w-[13px] animate-spin rounded-full border-2 border-[rgba(107,79,184,.3)] border-t-[#6B4FB8]"
                aria-hidden
              />
              사전 분석중
              <span className="sdots inline-flex w-[14px]">
                <i className="not-italic opacity-0 [animation:sgblink_1.4s_infinite]">.</i>
                <i className="not-italic opacity-0 [animation:sgblink_1.4s_infinite_200ms]">.</i>
                <i className="not-italic opacity-0 [animation:sgblink_1.4s_infinite_400ms]">.</i>
              </span>
            </div>
          )}
          {phase === 'complete' && (
            <div
              className="status-pre ml-auto inline-flex flex-none items-center gap-2 rounded-full border border-[rgba(107,79,184,.32)] bg-[rgba(107,79,184,.12)] px-[14px] py-[7px] font-disp text-[13px] font-bold text-[#6B4FB8]"
              data-testid="analysis-complete-badge"
            >
              ✓ 분석 완료
            </div>
          )}
        </div>

        {/* Fix #3: Counter + SVG in single .glass card */}
        <div
          className="glass-card"
          data-testid="segment-viz"
        >
          {/* Fix #2: Counter — label '가능한 세그먼트 조합 경우의 수', combo number from 16,777,216 */}
          <div className="sg-counter flex flex-col items-center gap-[3px] px-0 pt-[16px] pb-[14px] mb-[13px]">
            <span className="sg-clbl text-[11.5px] font-semibold text-ink-faint">세그먼트 조합 수</span>
            <span
              id="combo"
              ref={comboRef}
              className="sg-cnum font-mono text-[32px] font-bold tabular-nums text-ink"
              data-testid="analysis-counter"
            >
              {formatCombo(COMBO_START)}
            </span>
          </div>

          {/* Fix #1: Full SSOT SVG viewBox='0 0 680 500' with all .cat/.clu/.seg/.ln elements */}
          <svg
            ref={svgRef}
            width="100%"
            viewBox="0 0 680 500"
            role="img"
            style={{ padding: '0 8px 14px' }}
            aria-label="고객 세그먼트 결정 흐름"
          >
            <title>고객 세그먼트 결정 흐름</title>
            <defs>
              <marker id="sgArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </marker>
            </defs>

            {/* Column headers */}
            <text className="ts" x="114" y="28" textAnchor="middle" fontSize="12" fill="var(--ink-dim)">원천 데이터 (9항목)</text>
            <text className="ts" x="340" y="28" textAnchor="middle" fontSize="12" fill="var(--ink-dim)">군집 (4대 분류)</text>
            <text className="ts" x="569" y="28" textAnchor="middle" fontSize="12" fill="var(--ink-dim)">세그먼트</text>

            {/* Connection lines — .ln groups */}
            <g className="ln ln-A">
              <path className="ln ln-A" pathLength="1" d="M214 56 C242 56,242 82,270 82" fill="none" stroke="#6B4A2A" strokeWidth="1" opacity="0.5"/>
              <path className="ln ln-A" pathLength="1" d="M214 108 C242 108,242 82,270 82" fill="none" stroke="#6B4A2A" strokeWidth="1" opacity="0.5"/>
            </g>
            <g className="ln ln-B">
              <path className="ln ln-B" pathLength="1" d="M214 160 C242 160,242 186,270 186" fill="none" stroke="#5168DB" strokeWidth="0.8" opacity="0.45"/>
              <path className="ln ln-B" pathLength="1" d="M214 212 C242 212,242 186,270 186" fill="none" stroke="#5168DB" strokeWidth="0.8" opacity="0.45"/>
            </g>
            <g className="ln ln-C">
              <path className="ln ln-C" pathLength="1" d="M214 264 C242 264,242 316,270 316" fill="none" stroke="#CF8A3C" strokeWidth="0.8" opacity="0.5"/>
              <path className="ln ln-C" pathLength="1" d="M214 316 C242 316,242 316,270 316" fill="none" stroke="#CF8A3C" strokeWidth="0.8" opacity="0.5"/>
              <path className="ln ln-C" pathLength="1" d="M214 368 C242 368,242 316,270 316" fill="none" stroke="#CF8A3C" strokeWidth="0.8" opacity="0.5"/>
            </g>
            <g className="ln ln-D">
              <path className="ln ln-D" pathLength="1" d="M214 420 C242 420,242 446,270 446" fill="none" stroke="#6B4FB8" strokeWidth="0.8" opacity="0.45"/>
              <path className="ln ln-D" pathLength="1" d="M214 472 C242 472,242 446,270 446" fill="none" stroke="#6B4FB8" strokeWidth="0.8" opacity="0.45"/>
            </g>
            <g className="ln ln-cv">
              <path className="ln ln-cv" pathLength="1" d="M410 82 C438 82,438 264,438 264" fill="none" stroke="#9AA0AC" strokeWidth="1" opacity="0.45"/>
              <path className="ln ln-cv" pathLength="1" d="M410 186 C438 186,438 264,438 264" fill="none" stroke="#9AA0AC" strokeWidth="1" opacity="0.45"/>
              <path className="ln ln-cv" pathLength="1" d="M410 316 C438 316,438 264,438 264" fill="none" stroke="#9AA0AC" strokeWidth="1" opacity="0.45"/>
              <path className="ln ln-cv" pathLength="1" d="M410 446 C438 446,438 264,438 264" fill="none" stroke="#9AA0AC" strokeWidth="1" opacity="0.45"/>
            </g>
            <g className="ln ln-sg">
              <path className="ln ln-sg" pathLength="1" d="M480 256 C492 210,494 158,500 150" fill="none" stroke="#9AA0AC" strokeWidth="0.8" opacity="0.35"/>
              <path className="ln ln-sg" pathLength="1" d="M480 272 C492 330,494 386,500 392" fill="none" stroke="#9AA0AC" strokeWidth="0.8" opacity="0.35"/>
              <line className="ln ln-sg" pathLength="1" x1="482" y1="264" x2="500" y2="264" stroke="#5168DB" strokeWidth="2.5" markerEnd="url(#sgArrow)"/>
            </g>

            {/* Source data rows — 9 .cat groups */}
            <g className="cat" data-i="0" data-testid="sg-categories">
              <g className="box"><rect x="14" y="39" width="200" height="34" rx="8" strokeWidth="0.5" fill="rgba(255,255,255,.66)" stroke="var(--hair)"/></g>
              <circle cx="28" cy="56" r="4" fill="#6B4A2A"/>
              <text className="ts" x="42" y="56" dominantBaseline="central" fontSize="12" fill="var(--ink-dim)">차량 보유</text>
              <text className="th" x="204" y="56" textAnchor="end" dominantBaseline="central" fontSize="14" fontWeight="700" fill="var(--ink)">보유</text>
            </g>
            <g className="cat" data-i="1">
              <g className="box"><rect x="14" y="91" width="200" height="34" rx="8" strokeWidth="0.5" fill="rgba(255,255,255,.66)" stroke="var(--hair)"/></g>
              <circle cx="28" cy="108" r="4" fill="#6B4A2A"/>
              <text className="ts" x="42" y="108" dominantBaseline="central" fontSize="12" fill="var(--ink-dim)">주식 보유</text>
              <text className="th" x="204" y="108" textAnchor="end" dominantBaseline="central" fontSize="14" fontWeight="700" fill="var(--ink)">보유</text>
            </g>
            <g className="cat" data-i="2">
              <g className="box"><rect x="14" y="143" width="200" height="34" rx="8" strokeWidth="0.5" fill="rgba(255,255,255,.66)" stroke="var(--hair)"/></g>
              <circle cx="28" cy="160" r="4" fill="#5168DB"/>
              <text className="ts" x="42" y="160" dominantBaseline="central" fontSize="12" fill="var(--ink-dim)">신용 평점</text>
              <text className="th" x="204" y="160" textAnchor="end" dominantBaseline="central" fontSize="14" fontWeight="700" fill="var(--ink)">744점</text>
            </g>
            <g className="cat" data-i="3">
              <g className="box"><rect x="14" y="195" width="200" height="34" rx="8" strokeWidth="0.5" fill="rgba(255,255,255,.66)" stroke="var(--hair)"/></g>
              <circle cx="28" cy="212" r="4" fill="#5168DB"/>
              <text className="ts" x="42" y="212" dominantBaseline="central" fontSize="12" fill="var(--ink-dim)">부채(A저축)</text>
              <text className="th" x="204" y="212" textAnchor="end" dominantBaseline="central" fontSize="14" fontWeight="700" fill="var(--ink)">2,800만</text>
            </g>
            <g className="cat" data-i="4">
              <g className="box"><rect x="14" y="247" width="200" height="34" rx="8" strokeWidth="0.5" fill="rgba(255,255,255,.66)" stroke="var(--hair)"/></g>
              <circle cx="28" cy="264" r="4" fill="#CF8A3C"/>
              <text className="ts" x="42" y="264" dominantBaseline="central" fontSize="12" fill="var(--ink-dim)">대출반응확률</text>
              <text className="th" x="204" y="264" textAnchor="end" dominantBaseline="central" fontSize="14" fontWeight="700" fill="var(--ink)">자담 HIGH</text>
            </g>
            <g className="cat" data-i="5">
              <g className="box"><rect x="14" y="299" width="200" height="34" rx="8" strokeWidth="0.5" fill="rgba(255,255,255,.66)" stroke="var(--hair)"/></g>
              <circle cx="28" cy="316" r="4" fill="#CF8A3C"/>
              <text className="ts" x="42" y="316" dominantBaseline="central" fontSize="12" fill="var(--ink-dim)">금리민감확률</text>
              <text className="th" x="204" y="316" textAnchor="end" dominantBaseline="central" fontSize="14" fontWeight="700" fill="var(--ink)">민감 HIGH</text>
            </g>
            <g className="cat" data-i="6">
              <g className="box"><rect x="14" y="351" width="200" height="34" rx="8" strokeWidth="0.5" fill="rgba(255,255,255,.66)" stroke="var(--hair)"/></g>
              <circle cx="28" cy="368" r="4" fill="#CF8A3C"/>
              <text className="ts" x="42" y="368" dominantBaseline="central" fontSize="12" fill="var(--ink-dim)">부도확률</text>
              <text className="th" x="204" y="368" textAnchor="end" dominantBaseline="central" fontSize="14" fontWeight="700" fill="var(--ink)">Low</text>
            </g>
            <g className="cat" data-i="7">
              <g className="box"><rect x="14" y="403" width="200" height="34" rx="8" strokeWidth="0.5" fill="rgba(255,255,255,.66)" stroke="var(--hair)"/></g>
              <circle cx="28" cy="420" r="4" fill="#6B4FB8"/>
              <text className="ts" x="42" y="420" dominantBaseline="central" fontSize="12" fill="var(--ink-dim)">대출비교 조회</text>
              <text className="th" x="204" y="420" textAnchor="end" dominantBaseline="central" fontSize="14" fontWeight="700" fill="var(--ink)">1주내 3회</text>
            </g>
            <g className="cat" data-i="8">
              <g className="box"><rect x="14" y="455" width="200" height="34" rx="8" strokeWidth="0.5" fill="rgba(255,255,255,.66)" stroke="var(--hair)"/></g>
              <circle cx="28" cy="472" r="4" fill="#6B4FB8"/>
              <text className="ts" x="42" y="472" dominantBaseline="central" fontSize="12" fill="var(--ink-dim)">앱 행태이력</text>
              <text className="th" x="204" y="472" textAnchor="end" dominantBaseline="central" fontSize="14" fontWeight="700" fill="var(--ink)">한도 조회</text>
            </g>

            {/* Cluster boxes — 4 .clu groups + cv circle */}
            <g className="clu" data-c="A">
              <g className="box"><rect x="270" y="56" width="140" height="52" rx="12" strokeWidth="0.5" fill="rgba(255,255,255,.66)" stroke="var(--hair)"/></g>
              <text className="th" x="340" y="75" textAnchor="middle" dominantBaseline="central" fontSize="14" fontWeight="700" fill="var(--ink)">고객 자산·여력</text>
              <text className="ts" x="340" y="93" textAnchor="middle" dominantBaseline="central" fontSize="12" fill="var(--ink-dim)">차량·주식 멀티에셋</text>
            </g>
            <g className="clu" data-c="B">
              <g className="box"><rect x="270" y="160" width="140" height="52" rx="12" strokeWidth="0.5" fill="rgba(255,255,255,.66)" stroke="var(--hair)"/></g>
              <text className="th" x="340" y="179" textAnchor="middle" dominantBaseline="central" fontSize="14" fontWeight="700" fill="var(--ink)">신용·부채</text>
              <text className="ts" x="340" y="197" textAnchor="middle" dominantBaseline="central" fontSize="12" fill="var(--ink-dim)">중신용·고금리</text>
            </g>
            <g className="clu" data-c="C">
              <g className="box"><rect x="270" y="290" width="140" height="52" rx="12" strokeWidth="0.5" fill="rgba(255,255,255,.66)" stroke="var(--hair)"/></g>
              <text className="th" x="340" y="309" textAnchor="middle" dominantBaseline="central" fontSize="14" fontWeight="700" fill="var(--ink)">ML 예측모형</text>
              <text className="ts" x="340" y="327" textAnchor="middle" dominantBaseline="central" fontSize="12" fill="var(--ink-dim)">선호·민감·우량</text>
            </g>
            <g className="clu" data-c="D">
              <g className="box"><rect x="270" y="420" width="140" height="52" rx="12" strokeWidth="0.5" fill="rgba(255,255,255,.66)" stroke="var(--hair)"/></g>
              <text className="th" x="340" y="439" textAnchor="middle" dominantBaseline="central" fontSize="14" fontWeight="700" fill="var(--ink)">온라인 행동</text>
              <text className="ts" x="340" y="457" textAnchor="middle" dominantBaseline="central" fontSize="12" fill="var(--ink-dim)">대환탐색·전환임박</text>
            </g>
            {/* 조합 (cv circle) */}
            <g className="clu" data-c="cv">
              <g className="box"><circle cx="460" cy="264" r="22" strokeWidth="0.5" fill="rgba(255,255,255,.66)" stroke="var(--hair)"/></g>
              <text className="ts" x="460" y="264" textAnchor="middle" dominantBaseline="central" fontSize="12" fill="var(--ink-dim)">조합</text>
            </g>

            {/* Segment outcome rects — .seg groups */}
            <g className="seg" data-s="top">
              <g className="c-gray">
                <rect x="500" y="128" width="138" height="44" rx="12" strokeWidth="0.5" fill="rgba(255,255,255,.5)" stroke="var(--ink-faint)"/>
                <text className="th" x="569" y="150" textAnchor="middle" dominantBaseline="central" fontSize="14" fontWeight="700" fill="var(--title)">신용대출 제안형</text>
              </g>
            </g>
            <g className="seg" data-s="bottom">
              <g className="c-gray">
                <rect x="500" y="370" width="138" height="44" rx="12" strokeWidth="0.5" fill="rgba(255,255,255,.5)" stroke="var(--ink-faint)"/>
                <text className="th" x="569" y="392" textAnchor="middle" dominantBaseline="central" fontSize="14" fontWeight="700" fill="var(--title)">금융비교 안내형</text>
              </g>
            </g>
            <text className="ts" x="569" y="432" textAnchor="middle" fontSize="12" fill="var(--ink-dim)" opacity="0.45">… 외 다수</text>
            {/* Selected segment — c-blue */}
            <g
              className="seg"
              data-s="sel"
              data-testid="customer-segment-dot"
            >
              <g className="c-blue">
                <rect x="500" y="236" width="138" height="56" rx="14" strokeWidth="1.8" fill="var(--badge-bg)" stroke="var(--route)"/>
                <text className="th" x="569" y="256" textAnchor="middle" dominantBaseline="central" fontSize="14" fontWeight="700" fill="var(--route)">고금리 대환 타겟군</text>
                <text className="ts" x="569" y="276" textAnchor="middle" dominantBaseline="central" fontSize="12" fill="var(--route)">자동차 담보 제안 가능</text>
              </g>
            </g>
          </svg>
        </div>

        {/* 분석 완료 후 — 전략 정보 + 통화 버튼.
            SSOT .sg-final: opacity:0 → .show(opacity:1) 페이드인 (mount 토글 아님). */}
        {analysisComplete && (
          <>
            {/* sg-final: SSOT — opacity .5s 페이드인 + gap:12px */}
            <div
              className={clsx(
                'sg-final mt-[14px] flex flex-col gap-[12px] opacity-0 transition-opacity duration-500',
                analysisComplete && 'show opacity-100',
              )}
              data-testid="analysis-final"
            >
              <div className="glass-card sg-sec px-[17px] py-[15px]">
                <span className="sg-tag t2 mb-[11px] inline-block rounded-full bg-[var(--badge-bg)] px-[10px] py-[3px] font-mono text-[10px] font-bold uppercase tracking-[.08em] text-route">
                  상담 전략
                </span>
                <div className="strat-card flex flex-col">
                  {/* First strat-mod: 고금리 대환 니즈 공략 with rate-row */}
                  <div className="strat-mod py-[4px]">
                    <div className="strat-mod-h mb-[13px] flex items-center gap-2 font-disp text-sm font-extrabold text-ink">
                      <i className="ti ti-discount-2 text-[19px] text-route not-italic" aria-hidden></i>
                      고금리 대환 니즈 공략
                    </div>
                    {/* rate-row */}
                    <div className="rate-row flex items-stretch gap-[10px]">
                      {/* old rate chip */}
                      <div
                        className="rate-chip old flex flex-1 flex-col items-center justify-center gap-[5px] rounded-[13px] border border-[rgba(219,83,80,.32)] bg-[rgba(219,83,80,.1)] px-[6px] py-[12px] text-center"
                      >
                        <span className="rate-lbl text-[11px] font-semibold leading-[1.2] text-danger">저축은행 신용대출</span>
                        <span className="rate-num font-mono text-[29px] font-bold tabular-nums leading-[1] text-danger">
                          16.0<i className="not-italic text-[15px] font-semibold ml-[1px]">%</i>
                        </span>
                      </div>
                      {/* rate arrow */}
                      <div className="rate-arrow flex flex-shrink-0 flex-col items-center justify-center gap-[4px]">
                        <i className="ti ti-arrow-right not-italic text-[20px] text-ink-faint" aria-hidden></i>
                        <span
                          className="rate-delta whitespace-nowrap rounded-[10px] bg-[var(--badge-bg)] px-[8px] py-[2px] font-mono text-[11px] font-bold text-route"
                        >
                          −4.0%p
                        </span>
                      </div>
                      {/* new rate chip */}
                      <div
                        className="rate-chip new flex flex-1 flex-col items-center justify-center gap-[5px] rounded-[13px] border border-[rgba(53,81,214,.35)] bg-[var(--badge-bg)] px-[6px] py-[12px] text-center"
                      >
                        <span className="rate-lbl text-[11px] font-semibold leading-[1.2] text-route">당사 자동차담보</span>
                        <span className="rate-num font-mono text-[29px] font-bold tabular-nums leading-[1] text-route">
                          12.0<i className="not-italic text-[15px] font-semibold ml-[1px]">%</i>
                        </span>
                      </div>
                    </div>
                    {/* strat-result */}
                    <div className="strat-result mt-[12px] flex items-center gap-[7px] text-[13px] text-ink-dim">
                      <i className="ti ti-trending-down not-italic flex-shrink-0 text-[18px] text-route" aria-hidden></i>
                      <b className="font-bold text-ink">월 이자 부담</b>&nbsp;즉시 절감
                    </div>
                  </div>

                  {/* Second strat-mod: 담보 중심의 한도 제안 */}
                  <div className="strat-mod mt-[15px] border-t border-[var(--hair)] pt-[16px] pb-[4px]">
                    <div className="strat-mod-h mb-[13px] flex items-center gap-2 font-disp text-sm font-extrabold text-ink">
                      <i className="ti ti-car not-italic text-[19px] text-route" aria-hidden></i>
                      담보 중심의 한도 제안
                    </div>
                    <div className="flow-row flex flex-wrap items-center gap-[10px]">
                      <span className="flow-chip muted rounded-[11px] border border-[var(--hair)] bg-white/50 px-[13px] py-[7px] text-[13px] font-bold text-ink-faint line-through">
                        신용대출
                      </span>
                      <i className="ti ti-arrow-right flow-ar not-italic text-[18px] text-ink-faint" aria-hidden></i>
                      <span className="flow-chip strong rounded-[11px] border border-route bg-route px-[16px] py-[9px] text-base font-bold text-white shadow-[0_6px_16px_-8px_rgba(53,81,214,.6)]">
                        자동차 담보대출
                      </span>
                    </div>
                    <div className="flow-sub mt-3 text-[12.5px] leading-[1.55] text-ink-dim">
                      보유 <b className="font-bold text-ink">실물자산(차량)</b> 활용 · 상품 반응도{' '}
                      <b className="hi font-bold text-route">HIGH</b>
                    </div>
                    <div className="strat-result mt-[12px] flex items-center gap-[7px] text-[13px] text-ink-dim">
                      <i className="ti ti-shield-check not-italic flex-shrink-0 text-[18px] text-route" aria-hidden></i>
                      <b className="font-bold text-ink">안정적 한도</b>&nbsp;·&nbsp;<b className="font-bold text-ink">최적 금리</b>&nbsp;제안
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* sg-btnwrap: SSOT places this OUTSIDE sg-final, right after it */}
            <div className="sg-btnwrap flex justify-center gap-[10px]" data-testid="call-button-wrapper">
              <button
                type="button"
                id="sgReplay"
                className="sg-btn mt-[14px] inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--card-bd)] bg-[var(--card-soft)] px-4 py-[8px] font-disp text-[12px] font-bold text-ink-dim transition-all duration-[180ms] hover:border-route hover:text-route cursor-pointer"
                onClick={() => runAnimation()}
              >
                <i className="ti ti-refresh" aria-hidden="true" />
                다시 재생
              </button>
              {callId && (
                <CallButton customerId={customerId} analysisComplete={analysisComplete} />
              )}
            </div>
          </>
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
