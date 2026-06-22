// Badge wrapper (shared `*`). Tone → SSOT adm-badge palette mapping lives here only.
// SSOT .adm-badge: inline-flex gap-[5px] text-[11px] font-bold rounded-full px-[10px] py-[3px]
// Each badge has a 6px pulsing .dot circle child.
import type { CSSProperties, ReactNode } from 'react';

export type BadgeTone = 'active' | 'noanswer' | 'rejected' | 'signup' | 'escalate' | 'neutral';

// SSOT color map per tone
// live  = IN_CALL/ACCEPTED        → var(--route)=#3551D6, bg rgba(53,81,214,.1)
// wait  = DIALING/RINGING         → var(--hazard-ink)=#8A5A1E, bg rgba(207,138,60,.14)
// done  = ENDED                   → var(--go)=#2E9E6E, bg rgba(107,74,42,.12)  [SSOT .done]
// miss  = needs_agent             → var(--danger)=#DB5350, bg rgba(219,83,80,.12)
// pre   = TRANSFER_PENDING/JOINED → purple #6B4FB8, bg rgba(107,79,184,.12)
// neutral = REJECTED              → ink-dim gray

type ToneStyle = {
  color: string;
  background: string;
  dotBg: string;
  pulse: boolean;
};

const TONE_STYLE: Record<BadgeTone, ToneStyle> = {
  // live — IN_CALL, ACCEPTED
  active: {
    color: '#3551D6',
    background: 'rgba(53,81,214,.1)',
    dotBg: '#3551D6',
    pulse: true,
  },
  // wait — DIALING, RINGING
  noanswer: {
    color: '#8A5A1E',
    background: 'rgba(207,138,60,.14)',
    dotBg: '#CF8A3C',
    pulse: true,
  },
  // miss — needs_agent / REJECTED-ish
  rejected: {
    color: '#DB5350',
    background: 'rgba(219,83,80,.12)',
    dotBg: '#DB5350',
    pulse: false,
  },
  // pre — AGENT_JOINED
  signup: {
    color: '#6B4FB8',
    background: 'rgba(107,79,184,.12)',
    dotBg: '#6B4FB8',
    pulse: true,
  },
  // escalate — TRANSFER_PENDING
  escalate: {
    color: '#6B4FB8',
    background: 'rgba(107,79,184,.12)',
    dotBg: '#6B4FB8',
    pulse: true,
  },
  // neutral — ENDED
  neutral: {
    color: '#2E9E6E',
    background: 'rgba(107,74,42,.12)',
    dotBg: '#2E9E6E',
    pulse: false,
  },
};

// Exported so tests can assert the state→tone mapping deterministically.
export const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  active: 'badge-active',
  noanswer: 'badge-noanswer',
  rejected: 'badge-rejected',
  signup: 'badge-signup',
  escalate: 'badge-escalate',
  neutral: 'badge-neutral',
};

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  const ts = TONE_STYLE[tone];
  const badgeStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: '11px',
    fontWeight: 700,
    borderRadius: '999px',
    padding: '3px 10px',
    width: 'fit-content',
    color: ts.color,
    background: ts.background,
  };
  const dotStyle: CSSProperties = {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    flexShrink: 0,
    background: ts.dotBg,
    animation: ts.pulse ? 'badgeDotPulse 1.5s ease-out infinite' : undefined,
  };
  return (
    <span className={BADGE_TONE_CLASS[tone]} style={badgeStyle}>
      <span style={dotStyle} />
      {children}
    </span>
  );
}
