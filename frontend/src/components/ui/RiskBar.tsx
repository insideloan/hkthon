// Churn-risk gauge bar wrapper (shared `*`). SSOT .adm-risk styling.
// Track: rgba(17,24,39,.08) — cool neutral semi-transparent to blend with light canvas.
// Fill: var(--route) solid — SSOT riskColor() returns 'var(--route)' for all values (unified brand blue).
// Pct text: font-mono 11px bold w-[30px] text-right, color matches fill (var(--route)).

/** Returns the risk fill color for a 0-100 churn-risk value.
 * SSOT riskColor() is a uniform brand-blue — kept as a function for test compatibility. */
export function riskClass(_value: number): string {
  return 'var(--route)';
}

export function RiskBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const fillColor = riskClass(clamped);
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-[6px] flex-1 overflow-hidden rounded-full min-w-[34px]"
        style={{ background: 'rgba(17,24,39,.08)' }}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${clamped}%`, background: fillColor }}
        />
      </div>
      <span
        className="font-mono text-[11px] font-bold w-[30px] text-right tabular-nums"
        style={{ color: fillColor }}
      >
        {clamped}%
      </span>
    </div>
  );
}
