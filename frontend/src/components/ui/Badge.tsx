// Badge wrapper (shared `*`). Tone → Tailwind class mapping lives here only.
import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export type BadgeTone = 'active' | 'noanswer' | 'rejected' | 'signup' | 'escalate' | 'neutral';

// Semantic queue palette (tailwind.config.ts, CONVENTIONS.md §6.2). Exported so
// tests can assert the state→class mapping deterministically.
export const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  active: 'bg-queue-active/20 text-amber-700',
  noanswer: 'bg-queue-noanswer/15 text-gray-800',
  rejected: 'bg-queue-rejected/15 text-orange-900',
  signup: 'bg-queue-signup/20 text-emerald-700',
  escalate: 'bg-queue-escalate/20 text-red-700',
  neutral: 'bg-gray-100 text-gray-700',
};

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        BADGE_TONE_CLASS[tone],
      )}
    >
      {children}
    </span>
  );
}
