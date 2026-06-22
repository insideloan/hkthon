// MOT store (Zustand). Holds the ordered list of Moments-of-Truth for the active
// call, fed by lib/appsync.ts onMotDetected (CONVENTIONS.md §3.2). Drives the
// JourneyMap markers + cautionPop (FRONTEND-009). Deduped + ordered by seq.
//
// MOT_MARKER_IDS maps seq (1-based) → SSOT marker element ID.
// markerStates: per-ID state machine: show → alert → blocked.
import { create } from 'zustand';
import type { MotDetected } from '@/types/realtime';

// SSOT: docs/consult_redesigned-3.html #rz-rate|#rz-compare|#rz-pay|#rz-security|#rz-avoid
export const MOT_MARKER_IDS = ['rz-rate', 'rz-compare', 'rz-pay', 'rz-security', 'rz-avoid'] as const;
export type MotMarkerId = (typeof MOT_MARKER_IDS)[number];

// State machine per SSOT CSS: opacity:0 (hidden) → show → alert → blocked
export type MarkerState = 'hidden' | 'show' | 'alert' | 'blocked';

export type MarkerEntry = {
  id: MotMarkerId;
  state: MarkerState;
  /** seq of the MotDetected that last touched this marker */
  seq: number | null;
};

type MotState = {
  mots: MotDetected[];
  markers: MarkerEntry[];
  /** seq of MOT currently showing cautionPop (null = hidden) */
  activeCautionSeq: number | null;
  /** Add a MOT from onMotDetected (idempotent on seq, keeps seq order). */
  addMot: (mot: MotDetected) => void;
  /** Transition a marker by SSOT element ID */
  setMarkerState: (id: MotMarkerId, state: MarkerState, seq: number) => void;
  /** Show cautionPop for the given seq */
  showCaution: (seq: number) => void;
  /** Hide cautionPop */
  hideCaution: () => void;
  reset: () => void;
};

const initialMarkers = (): MarkerEntry[] =>
  MOT_MARKER_IDS.map((id) => ({ id, state: 'hidden' as MarkerState, seq: null }));

export const useMotStore = create<MotState>((set) => ({
  mots: [],
  markers: initialMarkers(),
  activeCautionSeq: null,

  addMot: (mot) =>
    set((state) => {
      if (state.mots.some((m) => m.seq === mot.seq)) {
        // Re-emit may carry an updated outcome/churnAfter — replace in place.
        return { mots: state.mots.map((m) => (m.seq === mot.seq ? mot : m)) };
      }
      return { mots: [...state.mots, mot].sort((a, b) => a.seq - b.seq) };
    }),

  setMarkerState: (id, markerState, seq) =>
    set((state) => ({
      markers: state.markers.map((m) =>
        m.id === id ? { ...m, state: markerState, seq } : m,
      ),
    })),

  showCaution: (seq) => set({ activeCautionSeq: seq }),
  hideCaution: () => set({ activeCautionSeq: null }),

  reset: () => set({ mots: [], markers: initialMarkers(), activeCautionSeq: null }),
}));
