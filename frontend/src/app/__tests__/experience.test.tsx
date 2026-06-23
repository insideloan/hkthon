// 관리자 화면 체험 버튼 → 모달 입력 → 확인 → 큐 최상단 발신중 노출 통합 테스트.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import Home from '@/app/page';
import { useQueueStore } from '@/stores/queueStore';

// 테이블의 데이터 와이어링은 끄고(스토어 직접 시드), 라우터만 목.
vi.mock('@/lib/appsync', () => ({
  fetchQueue: vi.fn().mockResolvedValue({
    summary: { total: 0, needsAgent: 0, fraudSuspected: 0, inCall: 0 }, rows: [],
  }),
  subscribeQueueUpdates: () => () => {},
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

beforeEach(() => {
  useQueueStore.getState().reset();
  // 기존 행 1개 시드 — 체험 행이 그 "위"에 와야 함을 검증하기 위해.
  useQueueStore.getState().setQueue({
    summary: { total: 1, needsAgent: 0, fraudSuspected: 0, inCall: 1 },
    rows: [{
      callId: 'c-demo-02', customerName: '이정훈', state: 'IN_CALL',
      stage: '우려 풀기', churnRisk: 48, assignee: 'AI 코파일럿',
      channel: '아웃바운드', elapsedSec: 221, highlight: null,
    }],
  });
});
afterEach(() => useQueueStore.getState().reset());

describe('관리자 화면 체험 플로우', () => {
  it('renders a 체험 button in the header', () => {
    render(<Home />);
    expect(screen.getByTestId('experience-button')).toHaveTextContent('체험');
  });

  it('opens the modal on click', () => {
    render(<Home />);
    expect(screen.queryByTestId('experience-modal')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('experience-button'));
    expect(screen.getByTestId('experience-modal')).toBeInTheDocument();
  });

  it('confirm adds the customer as the TOP 발신중 row', () => {
    render(<Home />);
    fireEvent.click(screen.getByTestId('experience-button'));

    fireEvent.change(screen.getByTestId('exp-name'), { target: { value: '체험고객' } });
    fireEvent.change(screen.getByTestId('exp-age'), { target: { value: '52' } });
    fireEvent.click(screen.getByTestId('exp-confirm'));

    // 모달 닫힘.
    expect(screen.queryByTestId('experience-modal')).not.toBeInTheDocument();

    // 큐 스토어 최상단에 체험 고객 + DIALING.
    const rows = useQueueStore.getState().rows;
    expect(rows[0].customerName).toBe('체험고객');
    expect(rows[0].state).toBe('DIALING');
    expect(rows).toHaveLength(2); // 기존 1 + 체험 1

    // 표 첫 데이터 행이 체험 고객 + "발신중" 배지.
    const topRow = screen.getByTestId(`queue-row-${rows[0].callId}`);
    expect(within(topRow).getByText('체험고객')).toBeInTheDocument();
    expect(within(topRow).getByText('발신중')).toBeInTheDocument();
  });

  it('validates required name (no row added on empty name)', () => {
    render(<Home />);
    fireEvent.click(screen.getByTestId('experience-button'));
    fireEvent.click(screen.getByTestId('exp-confirm'));
    expect(screen.getByTestId('exp-error')).toBeInTheDocument();
    expect(screen.getByTestId('experience-modal')).toBeInTheDocument(); // 안 닫힘
    expect(useQueueStore.getState().rows).toHaveLength(1); // 추가 안 됨
  });
});
