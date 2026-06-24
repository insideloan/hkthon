// Badge wrapper (shared `*`). Tone → SSOT adm-badge palette mapping lives here only.
// SSOT .adm-badge: inline-flex gap-[5px] text-[11px] font-bold rounded-full px-[10px] py-[3px]
// Each badge has a 6px pulsing .dot circle child.
import type { CSSProperties, ReactNode } from 'react';

export type BadgeTone = 'active' | 'noanswer' | 'rejected' | 'signup' | 'escalate' | 'neutral';

// Color map per tone — premium SaaS light-neutral palette (mirrors :root tokens)
// live  = IN_CALL/ACCEPTED        → route=#2563eb, bg rgba(37,99,235,.1)
// wait  = DIALING/RINGING         → hazard-ink=#b45309, bg rgba(217,119,6,.12)
// done  = ENDED                   → go=#16a34a, bg rgba(22,163,74,.1)
// miss  = needs_agent             → danger=#ef4444, bg rgba(239,68,68,.1)
// pre   = TRANSFER_PENDING/JOINED → indigo #6366f1, bg rgba(99,102,241,.1)
// neutral = REJECTED              → ink-dim gray

type ToneStyle = {
  color: string;
  background: string;
  dotBg: string;
  pulse: boolean;
};

const TONE_STYLE: Record<BadgeTone, ToneStyle> = {
  // live — IN_CALL, ACCEPTED (neutral blue accent)
  active: {
    color: '#2563eb',
    background: 'rgba(37,99,235,.1)',
    dotBg: '#2563eb',
    pulse: true,
  },
  // wait — DIALING, RINGING (warning amber)
  noanswer: {
    color: '#b45309',
    background: 'rgba(217,119,6,.12)',
    dotBg: '#d97706',
    pulse: true,
  },
  // miss — needs_agent / REJECTED-ish (negative)
  rejected: {
    color: '#ef4444',
    background: 'rgba(239,68,68,.1)',
    dotBg: '#ef4444',
    pulse: false,
  },
  // pre — AGENT_JOINED (indigo)
  signup: {
    color: '#6366f1',
    background: 'rgba(99,102,241,.1)',
    dotBg: '#6366f1',
    pulse: true,
  },
  // escalate — TRANSFER_PENDING (indigo)
  escalate: {
    color: '#6366f1',
    background: 'rgba(99,102,241,.1)',
    dotBg: '#6366f1',
    pulse: true,
  },
  // neutral — ENDED (positive green)
  neutral: {
    color: '#16a34a',
    background: 'rgba(22,163,74,.1)',
    dotBg: '#16a34a',
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
