// CompliancePanel — AI 답변 작성→검수→삭제·재작성 연출 (FRONTEND-008 / #37).
// 상태머신: drafting → reviewing → redacting → redrafting → approved.
// 실시간 전이: onComplianceState(callId) 구독 (lib/appsync.ts). 표시 전용 — 점수/판정
// 산출은 AGENT(#18). 스타일은 ui/* 래퍼 + Tailwind (CONVENTIONS.md §6.1).
// 디자인 출처: data/archive/consult_redesigned-2.html 카드③.
'use client';

import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { subscribeComplianceState } from '@/lib/appsync';
import type {
  ComplianceCheck,
  CompliancePhase,
  ComplianceState,
  FinalSegment,
} from '@/types/compliance';

// 위반 표현이 가려지는 단계 (취소선 + violatedPolicies 노출).
const REDACTED_PHASES: ReadonlySet<CompliancePhase> = new Set([
  'redacting',
  'redrafting',
  'approved',
]);

// 가안 텍스트에서 violations 부분문자열을 위반 강조로 감싼다.
function renderDraft(draft: string, violations: string[], redacted: boolean) {
  if (violations.length === 0) return draft;
  // 가장 긴 매치부터 처리해 부분 겹침을 방지.
  const sorted = [...violations].sort((a, b) => b.length - a.length);
  const parts: Array<{ text: string; risk: boolean }> = [{ text: draft, risk: false }];
  for (const v of sorted) {
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.risk || !part.text.includes(v)) continue;
      const idx = part.text.indexOf(v);
      const before = part.text.slice(0, idx);
      const after = part.text.slice(idx + v.length);
      const replacement: Array<{ text: string; risk: boolean }> = [];
      if (before) replacement.push({ text: before, risk: false });
      replacement.push({ text: v, risk: true });
      if (after) replacement.push({ text: after, risk: false });
      parts.splice(i, 1, ...replacement);
      i += replacement.length - 1;
    }
  }
  return parts.map((p, i) =>
    p.risk ? (
      <span
        key={i}
        className={clsx(
          'rounded px-0.5 font-semibold text-danger',
          redacted ? 'bg-danger/10 line-through decoration-danger/60' : 'bg-danger/15',
        )}
        data-testid="cmp-violation"
      >
        {p.text}
      </span>
    ) : (
      <span key={i}>{p.text}</span>
    ),
  );
}

function CheckRow({ check }: { check: ComplianceCheck }) {
  const reviewed = check.flagged !== null && check.flagged !== undefined;
  const flagged = check.flagged === true;
  return (
    <li
      className={clsx(
        'flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs transition-colors',
        !reviewed && 'border-[var(--hair)] opacity-60',
        reviewed && flagged && 'border-danger/30 bg-danger/5',
        reviewed && !flagged && 'border-go/30 bg-go/5',
      )}
      data-testid="cmp-check"
      data-flagged={reviewed ? String(flagged) : 'pending'}
    >
      <span
        className={clsx(
          'grid h-4 w-4 flex-none place-items-center rounded-full text-[10px] font-bold text-white',
          !reviewed && 'bg-[var(--ink-faint)]',
          reviewed && flagged && 'bg-danger',
          reviewed && !flagged && 'bg-go',
        )}
        aria-hidden
      >
        {reviewed ? (flagged ? '!' : '✓') : ''}
      </span>
      <span className="flex-none font-semibold text-ink">{check.law}</span>
      <span className="min-w-0 truncate text-ink-dim">{check.desc}</span>
      {reviewed && (
        <span
          className={clsx(
            'ml-auto flex-none rounded px-1.5 py-0.5 text-[10px] font-bold',
            flagged ? 'bg-danger/10 text-danger' : 'bg-go/10 text-go',
          )}
        >
          {flagged ? '수정' : '이상無'}
        </span>
      )}
    </li>
  );
}

function FinalDiff({ segments }: { segments: FinalSegment[] }) {
  return (
    <p
      className="rounded-lg border border-go/30 bg-cmp-final px-2 py-1.5 text-xs leading-relaxed text-ink"
      data-testid="cmp-final"
    >
      {segments.map((seg, i) => {
        if (seg.del !== undefined) {
          return (
            <span key={i}>
              {seg.del && (
                <del className="mr-0.5 text-ink-faint line-through decoration-hazard/50">
                  {seg.del}
                </del>
              )}
              {seg.ins && (
                <ins className="rounded bg-danger/10 px-0.5 font-bold text-danger no-underline">
                  {seg.ins}
                </ins>
              )}
            </span>
          );
        }
        if (seg.ins !== undefined) {
          return (
            <ins
              key={i}
              className={clsx(
                'rounded bg-danger/10 px-0.5 font-bold text-danger no-underline',
                seg.added && "before:mr-0.5 before:text-[0.78em] before:content-['＋']",
              )}
            >
              {seg.ins}
            </ins>
          );
        }
        return <span key={i}>{seg.text}</span>;
      })}
    </p>
  );
}

const SECTION_LABEL = 'mb-1 font-mono text-[10px] font-bold uppercase tracking-wider text-ink-faint';

type CompliancePanelProps = {
  callId: string;
  /** Tests/Storybook seed state directly and skip the live subscription. */
  initialState?: ComplianceState;
  disableLiveData?: boolean;
};

export function CompliancePanel({
  callId,
  initialState,
  disableLiveData = false,
}: CompliancePanelProps) {
  const [state, setState] = useState<ComplianceState | null>(initialState ?? null);

  useEffect(() => {
    if (disableLiveData) return;
    const unsubscribe = subscribeComplianceState(
      callId,
      (next) => setState(next),
      (err) => console.error('onComplianceState 구독 오류', err),
    );
    return unsubscribe;
  }, [callId, disableLiveData]);

  if (!state) {
    return (
      <section aria-label="컴플라이언스 체크">
        <p className="text-xs text-ink-faint">상담 시작 대기</p>
      </section>
    );
  }

  const { phase, draft, violations, checks, violatedPolicies, final } = state;
  const redacted = REDACTED_PHASES.has(phase);
  const showChecks = phase !== 'drafting' && checks.length > 0;
  const showFinal = (phase === 'redrafting' || phase === 'approved') && final.length > 0;
  const approved = phase === 'approved';

  return (
    <div
      className="flex flex-col gap-2"
      aria-label="컴플라이언스 체크"
      data-testid="compliance-panel"
      data-phase={phase}
    >
      {/* 가안 발화 (1+2 기반) */}
      <div>
        <div className={SECTION_LABEL}>가안 발화</div>
        <p className="rounded-lg border border-danger/20 bg-cmp-draft px-2 py-1.5 text-xs leading-relaxed text-ink-dim" data-testid="cmp-draft">
          {renderDraft(draft, violations, redacted)}
        </p>
      </div>

      {/* 컴플라이언스 규제 검토 */}
      {showChecks && (
        <div>
          <div className={SECTION_LABEL}>컴플라이언스 규제 검토</div>
          <ul className="flex flex-col gap-1">
            {checks.map((c, i) => (
              <CheckRow key={`${c.law}-${i}`} check={c} />
            ))}
          </ul>
        </div>
      )}

      {/* 위반 정책 (redacting 단계) */}
      {phase === 'redacting' && violatedPolicies.length > 0 && (
        <div className="flex flex-wrap gap-1" data-testid="cmp-violated-policies">
          {violatedPolicies.map((p) => (
            <span key={p} className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-danger">
              {p} 위반
            </span>
          ))}
        </div>
      )}

      {/* 최종 발화 (수정 = 빨강) */}
      {showFinal && (
        <div>
          <div className={SECTION_LABEL}>최종 발화 (수정 = 빨강)</div>
          <FinalDiff segments={final} />
        </div>
      )}

      {/* 전 규제 통과 배지 */}
      {approved && (
        <div className="flex items-center gap-1.5 text-xs font-bold text-go" data-testid="cmp-pass">
          <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-go text-[9px] text-white" aria-hidden>
            ✓
          </span>
          전 규제 통과 · 송출 준비
        </div>
      )}
    </div>
  );
}
