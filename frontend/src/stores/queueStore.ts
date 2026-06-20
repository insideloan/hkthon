// Queue store (Zustand). Holds the admin dashboard queue snapshot + realtime merges.
// Server data via lib/appsync.ts only (CONVENTIONS.md §3.2 — no fetch in components).
import { create } from 'zustand';
import type { QueueResult, QueueRow, QueueSummary } from '@/types/queue';

type QueueState = {
  rows: QueueRow[];
  summary: QueueSummary | null;
  /** Replace the whole snapshot — used by both `queue` query and `onQueueUpdate`. */
  setQueue: (result: QueueResult) => void;
  /**
   * Merge a per-call churn risk (from onIndexUpdate) onto the matching row.
   * churnRisk is not in the queue wire contract, so we join it here.
   */
  mergeChurn: (callId: string, churnRisk: number) => void;
  reset: () => void;
};

export const useQueueStore = create<QueueState>((set) => ({
  rows: [],
  summary: null,
  setQueue: (result) => set({ rows: result.rows, summary: result.summary }),
  mergeChurn: (callId, churnRisk) =>
    set((state) => ({
      rows: state.rows.map((row) =>
        row.callId === callId ? { ...row, churnRisk } : row,
      ),
    })),
  reset: () => set({ rows: [], summary: null }),
}));
