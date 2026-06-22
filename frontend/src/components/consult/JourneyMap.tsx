// JourneyMap — 상담 여정 맵 MOT 마커 + 플로팅 (FRONTEND-009 / #38).
// SSOT: docs/consult_redesigned-3.html 여정 맵 (절대 기준).
//
// MOT 마커: #rz-rate|#rz-compare|#rz-pay|#rz-security|#rz-avoid (MOT_1~5)
//   상태 전이: hidden(opacity:0) → show → alert → blocked
//
// 플로팅: 차량이 위험 지점에 도착하면 #cautionPop(.show) 표시.
//   방어(outcome=defended)시 cautionPop 제거 + 마커 blocked.
//
// 내러티브: #banner(.nav-banner) eyebrow/lead/dist를 risk/def/done 상태로 갱신.
//   FRONTEND-012: churnRisk% → bannerDist + .rz marker risk-zone emphasis.
//
// Mock-first: BACKEND-007(mots/onMotDetected) 미완료.
//   disableLiveData=true 또는 NEXT_PUBLIC_USE_MOCK=1 이면 mock만 사용.
'use client';

import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { subscribeMotDetected, fetchMots } from '@/lib/appsync';
import * as appsyncMod from '@/lib/appsync';
import {
  useMotStore,
  MOT_MARKER_IDS,
  type MotMarkerId,
  type MarkerState,
} from '@/stores/motStore';
import type { MotDetected } from '@/types/realtime';

// SSOT 좌표: docs/consult_redesigned-3.html 각 rz 요소의 transform="translate(x,y)"
const MOT_MARKER_COORDS: Record<MotMarkerId, { x: number; y: number; label: string }> = {
  'rz-rate':     { x: 215,  y: 322, label: 'MOT_1' },
  'rz-compare':  { x: 430,  y: 330, label: 'MOT_2' },
  'rz-pay':      { x: 930,  y: 332, label: 'MOT_3' },
  'rz-security': { x: 1205, y: 336, label: 'MOT_4' },
  'rz-avoid':    { x: 1300, y: 322, label: 'MOT_5' },
};

// SSOT animationDelay 순서 대로 (rz-rate 0s, rz-compare 0.6s, rz-pay 1.1s, rz-security 1.6s, rz-avoid 2.1s)
const ANIMATION_DELAY: Record<MotMarkerId, string> = {
  'rz-rate':     '0s',
  'rz-compare':  '0.6s',
  'rz-pay':      '1.1s',
  'rz-security': '1.6s',
  'rz-avoid':    '2.1s',
};

// seq(1-based) → MotMarkerId mapping — MOT_1 is seq=1
function seqToMarkerId(seq: number): MotMarkerId | null {
  const id = MOT_MARKER_IDS[seq - 1];
  return id ?? null;
}

// Banner 텍스트 — SSOT bann 구조
type BannerContent = {
  type: 'risk' | 'def' | 'done';
  eyebrow: string;
  lead: string;
};

function makeBanner(mot: MotDetected): BannerContent {
  const isDefended = mot.outcome === 'defended';
  if (isDefended) {
    return {
      type: 'def',
      eyebrow: '↩ 경로 재탐색',
      lead: `<b>방어 완료</b> — MOT_${mot.seq} 우회`,
    };
  }
  return {
    type: 'risk',
    eyebrow: '⚠ 전방 위험 구간',
    lead: `<b>위험</b> 구간 진입 — MOT_${mot.seq}`,
  };
}

// ── RzMarker — SSOT .rz SVG 그룹 ─────────────────────────────────────────────
// rz-compare는 SSOT에서 ellipse(rx=44 ry=30), 나머지는 circle(r=33).
// rz-core class kept as harmless string for SSOT lineage; no external CSS needed.
function RzCore({ id, state: markerState }: { id: MotMarkerId; state: MarkerState }) {
  const isEllipse = id === 'rz-compare';
  const delay = ANIMATION_DELAY[id];

  // Stroke color: alert/show→hazard, blocked→go
  const strokeColor =
    markerState === 'blocked' ? 'var(--go)' : 'var(--hazard)';
  // Fill: blocked gets a subtle go tint
  const fillColor =
    markerState === 'blocked' ? 'var(--cmp-final, #f5fbf8)' : '#fff';

  if (isEllipse) {
    return (
      <ellipse
        className="rz-core"
        rx={44}
        ry={30}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={2.4}
        strokeDasharray={markerState === 'blocked' ? 'none' : '4 5'}
        style={{ animationDelay: delay }}
      />
    );
  }
  return (
    <circle
      className="rz-core"
      r={33}
      fill={fillColor}
      stroke={strokeColor}
      strokeWidth={2.4}
      strokeDasharray={markerState === 'blocked' ? 'none' : '4 5'}
      style={{ animationDelay: delay }}
    />
  );
}

type RzMarkerProps = {
  id: MotMarkerId;
  markerState: MarkerState;
  /** FRONTEND-012: churnRisk >= 50 → risk-zone marker emphasis */
  riskActive?: boolean;
};

// Note: 'rz', 'show', 'alert', 'blocked' class names are kept because
// mot.test.tsx asserts them via toHaveClass(). They are the test contract.
function RzMarker({ id, markerState, riskActive = false }: RzMarkerProps) {
  const { x, y, label } = MOT_MARKER_COORDS[id];
  const cls = clsx(
    'rz',
    markerState === 'show' && 'show',
    markerState === 'alert' && 'show alert',
    markerState === 'blocked' && 'show blocked',
    // FRONTEND-012: churnRisk >= 50 → add risk-active emphasis on hidden/shown markers
    riskActive && markerState !== 'blocked' && 'risk-active',
  );

  // Opacity: hidden→0, show/alert/blocked→1
  const opacity = markerState === 'hidden' ? 0 : 1;

  return (
    <g
      className={cls}
      id={id}
      transform={`translate(${x},${y})`}
      data-testid={`mot-marker-${id}`}
      data-marker-state={markerState}
      data-risk-active={riskActive ? 'true' : undefined}
      style={{
        opacity,
        transition: 'opacity 0.4s ease',
        // risk-active: subtle hazard glow outline effect via filter
        filter:
          riskActive && markerState !== 'blocked'
            ? 'drop-shadow(0 0 6px var(--hazard))'
            : undefined,
      }}
    >
      <RzCore id={id} state={markerState} />
      <text
        className="rz-label"
        y={5}
        textAnchor="middle"
        fill={markerState === 'blocked' ? 'var(--go)' : 'var(--hazard)'}
        fontFamily="var(--kr)"
        fontSize={18}
        fontWeight={800}
      >
        {label}
      </text>
      {/* rz-done: 방어 완료 체크 배지 (SSOT) — visible only when blocked */}
      <g
        className="rz-done"
        transform="translate(24,-22)"
        style={{ opacity: markerState === 'blocked' ? 1 : 0 }}
      >
        <circle r={9} fill="var(--go)" />
        <path
          d="M-4.5,0 l3,3 5,-6"
          stroke="#fff"
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </g>
  );
}

// ── CautionPop — SSOT #cautionPop (! 경고 삼각형) ────────────────────────────
// 'show' class is kept because mot.test.tsx asserts it via toHaveClass('show').
type CautionPopProps = {
  visible: boolean;
  x: number;
  y: number;
};

function CautionPop({ visible, x, y }: CautionPopProps) {
  return (
    <g
      id="cautionPop"
      className={clsx(visible && 'show')}
      transform={`translate(${x},${y - 48})`}
      data-testid="caution-pop"
      data-visible={String(visible)}
      style={{
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.3s ease',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <path
        d="M0,-18 L17,13 H-17 Z"
        fill="var(--danger)"
        stroke="#fff"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <text
        x={0}
        y={9}
        textAnchor="middle"
        fontSize={18}
        fontWeight={700}
        fill="#fff"
        fontFamily="var(--disp)"
      >
        !
      </text>
    </g>
  );
}

// ── NavBanner — SSOT #banner (.nav-banner) ────────────────────────────────────
// Rebuilt with Tailwind utilities + CSS var tokens (Option 2).
// glass-card = frosted bg from globals.css.
// dist: churnRisk% when available (FRONTEND-012), else MOT-derived dist.
type NavBannerProps = {
  banner: BannerContent | null;
  dist: number; // 0-100
};

// Turn icon SVG paths per banner type
const TURN_SVG: Record<'risk' | 'def' | 'done', string> = {
  def: '<path d="M12 20V8M12 8l-5 5M12 8l5 5" stroke="var(--route)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  risk: '<path d="M12 3l9 16H3L12 3z" fill="none" stroke="var(--danger)" stroke-width="2" stroke-linejoin="round"/><path d="M12 9v5" stroke="var(--danger)" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.2" fill="var(--danger)"/>',
  done: '<path d="M5 12.5l4.5 4.5L19 7" stroke="var(--go)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
};

// Accent color per type for the dist badge and border accent
const TYPE_ACCENT: Record<'risk' | 'def' | 'done', string> = {
  risk: 'var(--danger)',
  def: 'var(--route)',
  done: 'var(--go)',
};

function NavBanner({ banner, dist }: NavBannerProps) {
  const type = banner?.type ?? 'def';
  const eyebrow = banner?.eyebrow ?? 'NEXT · 다음 안내';
  const lead = banner?.lead ?? '출발지 — <b>초기 관심</b> 구간 진입 대기';
  const accent = TYPE_ACCENT[type];

  return (
    <div
      id="banner"
      className="glass-card flex items-center gap-3 px-4 py-3 rounded-xl"
      data-testid="journey-banner"
      data-banner-type={type}
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      {/* Turn icon — 24×24 SVG */}
      <span
        id="turnIc"
        className="flex-none w-6 h-6 flex items-center justify-center"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="w-full h-full"
          dangerouslySetInnerHTML={{ __html: TURN_SVG[type] }}
        />
      </span>

      {/* Text block — eyebrow + lead */}
      <span className="flex flex-col gap-0.5 flex-1 min-w-0">
        <span
          className="font-mono text-[10px] uppercase tracking-widest"
          style={{ color: 'var(--ink-faint)' }}
          id="bannerEye"
          data-testid="banner-eyebrow"
        >
          {eyebrow}
        </span>
        <span
          className="font-disp text-sm font-semibold leading-snug"
          style={{ color: 'var(--ink)' }}
          id="bannerLead"
          data-testid="banner-lead"
          dangerouslySetInnerHTML={{ __html: lead }}
        />
      </span>

      {/* Dist badge — churnRisk% */}
      <span
        className="font-mono text-sm font-bold flex-none tabular-nums"
        style={{ color: accent }}
        id="bannerDist"
        data-testid="banner-dist"
      >
        {dist}%
      </span>
    </div>
  );
}

// ── Route path — SSOT SVG road/route lines ───────────────────────────────────
// Simple road strip with a colored route overlay matching SSOT visual intent.
function RoutePath() {
  return (
    <g>
      {/* Road base — two lanes */}
      <path
        d="M50,355 Q400,360 760,355 Q1100,350 1580,355"
        stroke="var(--road, #c9c0b1)"
        strokeWidth={28}
        fill="none"
        strokeLinecap="round"
      />
      {/* Road edge lines */}
      <path
        d="M50,355 Q400,360 760,355 Q1100,350 1580,355"
        stroke="var(--road-edge, #b6ac9a)"
        strokeWidth={30}
        fill="none"
        strokeLinecap="round"
        opacity={0.4}
      />
      {/* Route highlight */}
      <path
        d="M50,355 Q400,360 760,355 Q1100,350 1580,355"
        stroke="var(--route)"
        strokeWidth={4}
        fill="none"
        strokeLinecap="round"
        strokeDasharray="12 8"
        opacity={0.7}
      />
    </g>
  );
}

// ── JourneyMap ────────────────────────────────────────────────────────────────
export type JourneyMapProps = {
  callId: string;
  /** Tests / Storybook: seed initial MOTs and skip live subscription. */
  initialMots?: MotDetected[];
  /** Tests / Storybook: seed initial churnRisk (0-100) for bannerDist. */
  initialChurnRisk?: number | null;
  disableLiveData?: boolean;
};

export function JourneyMap({
  callId,
  initialMots,
  initialChurnRisk = null,
  disableLiveData = false,
}: JourneyMapProps) {
  const { markers, activeCautionSeq, addMot, setMarkerState, showCaution, hideCaution, reset } =
    useMotStore();

  const bannerRef = useRef<BannerContent | null>(null);
  const distRef = useRef(0);

  // FRONTEND-012: churnRisk% → bannerDist + rz marker risk-zone emphasis
  const [churnRisk, setChurnRisk] = useState<number | null>(initialChurnRisk ?? null);

  // ── seed initialMots (always, even in live mode — hydrate from query result)
  useEffect(() => {
    reset();
    if (initialMots && initialMots.length > 0) {
      for (const mot of initialMots) {
        hydrateMot(mot);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  // ── initial query load (fetchMots) ──────────────────────────────────────────
  useEffect(() => {
    if (disableLiveData || initialMots !== undefined) return;
    let cancelled = false;
    fetchMots(callId).then((mots) => {
      if (cancelled) return;
      for (const mot of mots) hydrateMot(mot);
    }).catch((err) => {
      console.error('mots 쿼리 오류', err);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, disableLiveData]);

  // ── live subscription: onMotDetected ────────────────────────────────────────
  useEffect(() => {
    if (disableLiveData) return;
    const unsubscribe = subscribeMotDetected(
      callId,
      (mot) => hydrateMot(mot),
      (err) => console.error('onMotDetected 구독 오류', err),
    );
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, disableLiveData]);

  // ── FRONTEND-012: live subscription: onIndexUpdate → churnRisk ──────────────
  useEffect(() => {
    if (disableLiveData) return;
    // Guard: partial test mocks may omit subscribeIndexUpdate — check existence
    // before access to avoid Vitest mock proxy throw on undefined named exports.
    if (!('subscribeIndexUpdate' in appsyncMod)) return;
    const sub = appsyncMod.subscribeIndexUpdate;
    if (typeof sub !== 'function') return;
    const unsubscribe = sub(
      callId,
      (index) => setChurnRisk(index.churnRisk),
      (err) => console.error('onIndexUpdate(JourneyMap) 구독 오류', err),
    );
    return unsubscribe;
  }, [callId, disableLiveData]);

  // ── helper: apply a single MotDetected to store state ──────────────────────
  function hydrateMot(mot: MotDetected) {
    addMot(mot);
    const markerId = seqToMarkerId(mot.seq);
    if (!markerId) return;

    if (mot.outcome === 'defended') {
      // Defense: hide cautionPop, mark blocked
      hideCaution();
      setMarkerState(markerId, 'blocked', mot.seq);
      const content = makeBanner(mot);
      bannerRef.current = content;
    } else {
      // Risk arrival: show + alert state, show cautionPop
      setMarkerState(markerId, 'alert', mot.seq);
      showCaution(mot.seq);
      const content = makeBanner(mot);
      bannerRef.current = content;
      // Estimate dist from seq (each MOT is ~20% of journey)
      distRef.current = Math.round((mot.seq / MOT_MARKER_IDS.length) * 100);
    }
  }

  // Determine which marker is showing cautionPop
  const cautionMarkerId =
    activeCautionSeq !== null ? seqToMarkerId(activeCautionSeq) : null;
  const cautionCoords = cautionMarkerId
    ? MOT_MARKER_COORDS[cautionMarkerId]
    : { x: 0, y: 0 };

  // FRONTEND-012: churnRisk% drives bannerDist when available; mark rz zones active
  const bannerDist = churnRisk !== null ? churnRisk : distRef.current;
  // A marker is "risk-active" if churnRisk >= 50 (high-risk zone emphasis per SSOT)
  const isHighRisk = churnRisk !== null && churnRisk >= 50;

  return (
    <section
      className="flex flex-col gap-2 w-full"
      aria-label="상담 여정 맵"
      data-testid="journey-map"
      data-churn-risk={churnRisk !== null ? churnRisk : undefined}
    >
      <NavBanner banner={bannerRef.current} dist={bannerDist} />

      <svg
        viewBox="25 12 1610 418"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="상담 경로 여정 맵"
        data-testid="journey-svg"
        className="w-full"
        style={{ background: 'var(--canvas)', borderRadius: 12 }}
      >
        {/* Road/route path — visual backdrop */}
        <RoutePath />

        {/* MOT 마커 (SSOT: .rz 그룹) */}
        <g fontFamily="var(--kr)" fontSize={18} fontWeight={800}>
          {markers.map((entry) => (
            <RzMarker
              key={entry.id}
              id={entry.id}
              markerState={entry.state}
              riskActive={isHighRisk}
            />
          ))}
        </g>

        {/* cautionPop (SSOT: #cautionPop) */}
        <CautionPop
          visible={activeCautionSeq !== null}
          x={cautionCoords.x}
          y={cautionCoords.y}
        />
      </svg>
    </section>
  );
}
