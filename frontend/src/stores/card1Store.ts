// 카드① 발화분석 store (Zustand) — SSOT 카드① #card-emo의 orb bins + 전략 그리드 상태.
// 엔진이 runChain 단계에 맞춰 기록하고, SpeechAnalysis가 engineMode에서 구독한다.
import { create } from 'zustand';
import type { OrbEntry } from '@/consult-engine/types';

// 전략 그리드 진행: idle(20장 정렬) → swiping(좌로 스와이프) → resolved(선택 1~2장 확대)
export type StratPhase = 'idle' | 'swiping' | 'resolved';

type Card1State = {
  // 3개 bin의 orb (null = 아직 안 떨어짐). SSOT #slot-psy/intent/obstacle.
  psy: OrbEntry | null;
  intent: OrbEntry | null;
  obstacle: OrbEntry | null;
  // 전략 그리드
  stratPhase: StratPhase;
  picked: number[]; // 선택된 STRAT20 인덱스(최대 2)
  // solveArrow(▼) 노출
  solveArrow: boolean;

  setOrb: (cat: 'psy' | 'intent' | 'obstacle', orb: OrbEntry) => void;
  setStratPhase: (p: StratPhase) => void;
  setPicked: (idxs: number[]) => void;
  setSolveArrow: (on: boolean) => void;
  reset: () => void;
};

const initial = {
  psy: null,
  intent: null,
  obstacle: null,
  stratPhase: 'idle' as StratPhase,
  picked: [] as number[],
  solveArrow: false,
};

export const useCard1Store = create<Card1State>((set) => ({
  ...initial,
  setOrb: (cat, orb) => set({ [cat]: orb } as Partial<Card1State>),
  setStratPhase: (p) => set({ stratPhase: p }),
  setPicked: (idxs) => set({ picked: idxs }),
  setSolveArrow: (on) => set({ solveArrow: on }),
  reset: () => set({ ...initial, picked: [] }),
}));
