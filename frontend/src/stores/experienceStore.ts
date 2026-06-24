// 체험(experience) 고객 스토어 — 입력값으로 만든 전체 프로필을 callId로 보존한다.
//
// 배경: 큐 wire(QueueRow)는 이름·subtitle·이탈위험만 담을 수 있어, 체험 모달에서
// 입력한 성별·대출·자산·신용점수·금리가 큐 행에는 들어가지 못한다. 그 전체 프로필을
// 여기 세션 스토어에 저장해, CRM 상세(/crm/exp-*)와 라이브 인사말이 callId로 조회한다.
// 데모(mock) 전용 — 백엔드 영속화는 후속 작업.
import { create } from 'zustand';
import type { ExperienceCustomer } from '@/lib/experience';

type ExperienceState = {
  /** callId → 체험 고객 전체 레코드. */
  customers: Record<string, ExperienceCustomer>;
  /** 체험 고객 1명 저장(같은 callId면 교체). */
  addCustomer: (customer: ExperienceCustomer) => void;
  /** callId로 조회(없으면 undefined). */
  getCustomer: (callId: string) => ExperienceCustomer | undefined;
  reset: () => void;
};

export const useExperienceStore = create<ExperienceState>((set, get) => ({
  customers: {},
  addCustomer: (customer) =>
    set((state) => ({
      customers: { ...state.customers, [customer.callId]: customer },
    })),
  getCustomer: (callId) => get().customers[callId],
  reset: () => set({ customers: {} }),
}));
