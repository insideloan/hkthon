// Call store (Zustand). Holds the live consult-screen state for the active call:
// transcript, per-turn analysis, churn/emotion index, compliance, and MOTs.
// Server data flows in via lib/appsync.ts subscriptions only (CONVENTIONS.md §3.2
// — no fetch in components). FRONTEND consumes the AGENT-produced values; it never
// computes churnRisk/emotion (CHURN-RISK-LEXICON.md: AGENT owns the score).
import { create } from 'zustand';
import type { Turn, IndexUpdate, SpeechAnalysis, StrategyUpdate } from '@/types/realtime';
import type { ComplianceState } from '@/types/compliance';

type CallState = {
  callId: string | null;
  // transcript — appended per onTurn, deduped + ordered by seq.
  turns: Turn[];
  // 이탈위험도/감정 — latest onIndexUpdate (null until first event).
  churnRisk: number | null;
  emotion: string | null;
  // 발화 분석 카드① — latest onSpeechAnalysis keyed by turnSeq.
  speechAnalysis: SpeechAnalysis | null;
  // 상담 전략 카드② — latest onStrategyUpdate.
  strategy: StrategyUpdate | null;
  // 컴플라이언스 패널 — latest onComplianceState.
  compliance: ComplianceState | null;

  /** Bind the store to a call (clears prior state if the id changed). */
  setCallId: (callId: string) => void;
  /** Append a turn from onTurn (idempotent on seq, keeps seq order). */
  appendTurn: (turn: Turn) => void;
  /** Apply onIndexUpdate — churnRisk/emotion. */
  setIndex: (index: IndexUpdate) => void;
  setSpeechAnalysis: (analysis: SpeechAnalysis) => void;
  setStrategy: (strategy: StrategyUpdate) => void;
  setCompliance: (state: ComplianceState) => void;
  reset: () => void;
};

const initial = {
  callId: null,
  turns: [] as Turn[],
  churnRisk: null,
  emotion: null,
  speechAnalysis: null,
  strategy: null,
  compliance: null,
};

export const useCallStore = create<CallState>((set) => ({
  ...initial,
  setCallId: (callId) =>
    set((state) => (state.callId === callId ? state : { ...initial, callId })),
  appendTurn: (turn) =>
    set((state) => {
      if (state.turns.some((t) => t.seq === turn.seq)) {
        // Replace in place — a re-emit may carry corrected text.
        return {
          turns: state.turns.map((t) => (t.seq === turn.seq ? turn : t)),
        };
      }
      return {
        turns: [...state.turns, turn].sort((a, b) => a.seq - b.seq),
      };
    }),
  setIndex: (index) =>
    set({ churnRisk: index.churnRisk, emotion: index.emotion }),
  setSpeechAnalysis: (analysis) => set({ speechAnalysis: analysis }),
  setStrategy: (strategy) => set({ strategy }),
  setCompliance: (compliance) => set({ compliance }),
  reset: () => set({ ...initial }),
}));
