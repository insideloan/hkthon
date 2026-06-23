// Queue store (Zustand). Holds the admin dashboard queue snapshot + realtime merges.
// Server data via lib/appsync.ts only (CONVENTIONS.md §3.2 — no fetch in components).
import { create } from 'zustand';
import type { QueueResult, QueueRow, QueueSummary } from '@/types/queue';

type QueueState = {
  rows: QueueRow[];
  summary: QueueSummary | null;
  /**
   * Locally-created 체험(experience) rows, kept separate from the server/mock
   * snapshot so the periodic queue refresh (mock ticker / onQueueUpdate refetch)
   * can't wipe them. Always surfaced at the TOP of `rows`, newest first.
   */
  experienceRows: QueueRow[];
  /** Replace the whole snapshot — used by both `queue` query and `onQueueUpdate`. */
  setQueue: (result: QueueResult) => void;
  /**
   * Merge a per-call churn risk (from onIndexUpdate) onto the matching row.
   * churnRisk is not in the queue wire contract, so we join it here.
   */
  mergeChurn: (callId: string, churnRisk: number) => void;
  /** Drop a single row from the local snapshot (admin manual clear). */
  removeRow: (callId: string) => void;
  /**
   * Insert a row at the TOP of the queue and bump summary.total.
   * Used by the 체험 (experience) flow: a newly-created customer surfaces as the
   * topmost 발신중(DIALING) row. Replaces any existing row with the same callId.
   */
  prependRow: (row: QueueRow) => void;
  reset: () => void;
};

/** 서버/목 스냅샷 위에 체험 행을 항상 최상단으로 합친다. callId 중복은 체험 우선. */
function withExperience(snapshot: QueueRow[], experience: QueueRow[]): QueueRow[] {
  const expIds = new Set(experience.map((r) => r.callId));
  return [...experience, ...snapshot.filter((r) => !expIds.has(r.callId))];
}

function bumpTotal(summary: QueueSummary | null, delta: number): QueueSummary {
  const base = summary ?? { total: 0, needsAgent: 0, fraudSuspected: 0, inCall: 0 };
  return { ...base, total: Math.max(0, base.total + delta) };
}

export const useQueueStore = create<QueueState>((set) => ({
  rows: [],
  summary: null,
  experienceRows: [],
  setQueue: (result) =>
    set((state) => {
      const rows = withExperience(result.rows, state.experienceRows);
      // 체험 행이 있을 때만 total을 보정(서버 행 수 + 체험 행 수). 없으면 서버
      // summary를 그대로 통과시킨다(서버 total은 row 수와 다를 수 있음).
      const summary =
        state.experienceRows.length > 0
          ? { ...result.summary, total: result.summary.total + state.experienceRows.length }
          : result.summary;
      return { rows, summary };
    }),
  mergeChurn: (callId, churnRisk) =>
    set((state) => ({
      rows: state.rows.map((row) =>
        row.callId === callId ? { ...row, churnRisk } : row,
      ),
    })),
  removeRow: (callId) =>
    set((state) => ({
      rows: state.rows.filter((row) => row.callId !== callId),
      // 체험 행 삭제도 영구적이게(다음 refresh에서 되살아나지 않도록).
      experienceRows: state.experienceRows.filter((row) => row.callId !== callId),
    })),
  prependRow: (row) =>
    set((state) => {
      const isNew = !state.experienceRows.some((r) => r.callId === row.callId);
      const experienceRows = [
        row,
        ...state.experienceRows.filter((r) => r.callId !== row.callId),
      ];
      const snapshot = state.rows.filter(
        (r) => !experienceRows.some((e) => e.callId === r.callId),
      );
      const rows = withExperience(snapshot, experienceRows);
      // 새 체험 고객일 때만 total +1 (같은 callId 교체는 카운트 변화 없음).
      return {
        experienceRows,
        rows,
        summary: bumpTotal(state.summary, isNew ? 1 : 0),
      };
    }),
  reset: () => set({ rows: [], summary: null, experienceRows: [] }),
}));
