// MOT store (Zustand). Holds the ordered list of Moments-of-Truth for the active
// call, fed by lib/appsync.ts onMotDetected (CONVENTIONS.md §3.2). Drives the
// JourneyMap markers + MotFloating (FRONTEND-009/010). Deduped + ordered by seq.
import { create } from 'zustand';
import type { MotDetected } from '@/types/realtime';

type MotState = {
  mots: MotDetected[];
  /** Add a MOT from onMotDetected (idempotent on seq, keeps seq order). */
  addMot: (mot: MotDetected) => void;
  reset: () => void;
};

export const useMotStore = create<MotState>((set) => ({
  mots: [],
  addMot: (mot) =>
    set((state) => {
      if (state.mots.some((m) => m.seq === mot.seq)) {
        // Re-emit may carry an updated outcome/churnAfter — replace in place.
        return { mots: state.mots.map((m) => (m.seq === mot.seq ? mot : m)) };
      }
      return { mots: [...state.mots, mot].sort((a, b) => a.seq - b.seq) };
    }),
  reset: () => set({ mots: [] }),
}));
