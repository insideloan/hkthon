// Churn-risk gauge bar wrapper (shared `*`). Tailwind lives here only.
import { clsx } from 'clsx';

/** Returns the gauge fill class for a 0-100 churn-risk value. */
export function riskClass(value: number): string {
  if (value >= 60) return 'bg-risk-high';
  if (value >= 35) return 'bg-risk-mid';
  return 'bg-risk-low';
}

export function RiskBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-200"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={clsx('h-full rounded-full', riskClass(clamped))}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="w-9 text-right text-xs tabular-nums text-gray-700">{clamped}%</span>
    </div>
  );
}
