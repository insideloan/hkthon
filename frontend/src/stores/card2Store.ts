// 카드② DB분석 store (Zustand) — SSOT 카드② #card-db의 사용데이터 pills + 다이어그램 상태.
// 엔진이 runChain 단계에 맞춰 기록하고, DbCard가 구독한다.
import { create } from 'zustand';
import type { DiagEntry } from '@/consult-engine/types';

type Card2State = {
  // 사용데이터 칩(DB명). SSOT #dbUse.
  use: string[];
  // use 칩 flash(강조) 단계 통과 여부 → dbBridge(▼) 노출
  flash: boolean;
  bridge: boolean;
  // 분석결과 도식. null이면 아직 미표시. SSOT #dbRes.
  diag: DiagEntry | null;
  // 다이어그램 노드 중 몇 개까지 등장했는지(staggered). diag.nodes 길이까지.
  shownNodes: number;
  // 결과 배너 노출
  bannerOn: boolean;

  setUse: (use: string[]) => void;
  setFlash: (on: boolean) => void;
  setBridge: (on: boolean) => void;
  setDiag: (d: DiagEntry) => void;
  setShownNodes: (n: number) => void;
  setBannerOn: (on: boolean) => void;
  reset: () => void;
};

const initial = {
  use: [] as string[],
  flash: false,
  bridge: false,
  diag: null,
  shownNodes: 0,
  bannerOn: false,
};

export const useCard2Store = create<Card2State>((set) => ({
  ...initial,
  setUse: (use) => set({ use }),
  setFlash: (on) => set({ flash: on }),
  setBridge: (on) => set({ bridge: on }),
  setDiag: (d) => set({ diag: d }),
  setShownNodes: (n) => set({ shownNodes: n }),
  setBannerOn: (on) => set({ bannerOn: on }),
  reset: () => set({ ...initial, use: [] }),
}));
