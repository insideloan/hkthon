// Consult cockpit store (Zustand) — 시나리오 엔진(useConsultEngine)이 타이밍에 맞춰
// 기록하고, 카드 컴포넌트들이 선언적으로 구독한다. AppSync 대체(데모 전용).
//
// 카드 phase: idle → run → ok (SSOT cardIdle/cardRun/cardOk 라인 1917–1919에 대응).
// run.risky는 위험 발화 시 카드①에 적용.
import { create } from 'zustand';
import type { ComplianceState } from '@/types/compliance';

export type CardPhase = 'idle' | 'run' | 'run-risky' | 'ok';

type ConsultState = {
  // 3개 카드 상태
  card1: CardPhase;
  card2: CardPhase;
  card3: CardPhase;
  // .cc__head의 #pipeSrc — "분석 중: '…'" 라벨 (현재 분석 중인 고객 발화 조각)
  pipeSrc: string | null;
  // AI 응답 로딩 버블 표시 여부
  aiLoading: boolean;
  // 푸터 컴플라이언스 버튼 상태 (SSOT comp-btn: idle|armed)
  compBtn: 'idle' | 'armed';
  // 카드③ 컴플라이언스 상태 (엔진이 단계별 갱신, CompliancePanel이 engineMode에서 구독)
  compliance: ComplianceState | null;

  setCardPhase: (card: 'card1' | 'card2' | 'card3', phase: CardPhase) => void;
  setPipeSrc: (src: string | null) => void;
  setAiLoading: (on: boolean) => void;
  setCompBtn: (s: 'idle' | 'armed') => void;
  setCompliance: (c: ComplianceState | null) => void;
  reset: () => void;
};

const initial = {
  card1: 'idle' as CardPhase,
  card2: 'idle' as CardPhase,
  card3: 'idle' as CardPhase,
  pipeSrc: null,
  aiLoading: false,
  compBtn: 'idle' as const,
  compliance: null,
};

export const useConsultStore = create<ConsultState>((set) => ({
  ...initial,
  setCardPhase: (card, phase) => set({ [card]: phase } as Partial<ConsultState>),
  setPipeSrc: (src) => set({ pipeSrc: src }),
  setAiLoading: (on) => set({ aiLoading: on }),
  setCompBtn: (s) => set({ compBtn: s }),
  setCompliance: (c) => set({ compliance: c }),
  reset: () => set({ ...initial }),
}));
