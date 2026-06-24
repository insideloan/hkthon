// RTL tests for OutboundQueueTable (FRONTEND-001 / #30 Acceptance).
// jest-dom/vitest extends `expect` with DOM matchers (toBeInTheDocument 등) and
// registers their types — needed under `tsc --noEmit` since this branch has no
// vitest setup file.
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, act, fireEvent } from '@testing-library/react';
import { OutboundQueueTable } from '@/components/queue/OutboundQueueTable';
import { BADGE_TONE_CLASS } from '@/components/ui/Badge';
import { useQueueStore } from '@/stores/queueStore';
import type { QueueResult, QueueRow } from '@/types/queue';

// Mock the AppSync layer so we can drive the onQueueUpdate stream by hand.
const emptyResult: QueueResult = {
  summary: { total: 0, needsAgent: 0, fraudSuspected: 0, inCall: 0 },
  rows: [],
};
const fetchQueue = vi.fn().mockResolvedValue(emptyResult);
let emitQueueUpdate: ((result: QueueResult) => void) | null = null;
const unsubscribe = vi.fn();

vi.mock('@/lib/appsync', () => ({
  fetchQueue: (...args: unknown[]) => fetchQueue(...args),
  subscribeQueueUpdates: (onData: (r: QueueResult) => void) => {
    emitQueueUpdate = onData;
    return unsubscribe;
  },
}));

// Rows navigate via the app router on click — mock it so we can assert pushes.
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

function makeRow(over: Partial<QueueRow> = {}): QueueRow {
  return {
    callId: 'c1',
    customerName: '김영수',
    state: 'IN_CALL',
    stage: 'S1',
    assignee: 'AI 코파일럿',
    channel: '아웃바운드',
    highlight: null,
    elapsedSec: 95,
    ...over,
  };
}

const summary = { total: 1, needsAgent: 0, fraudSuspected: 0, inCall: 1 };

function seed(rows: QueueRow[]) {
  act(() => {
    useQueueStore.getState().setQueue({ summary, rows });
  });
}

afterEach(() => {
  act(() => useQueueStore.getState().reset());
  fetchQueue.mockReset();
  fetchQueue.mockResolvedValue(emptyResult);
  unsubscribe.mockReset();
  push.mockReset();
  emitQueueUpdate = null;
});

describe('OutboundQueueTable', () => {
  it('renders 3 mock rows', () => {
    seed([
      makeRow({ callId: 'c1', customerName: '김영수' }),
      makeRow({ callId: 'c2', customerName: '이민정', state: 'TRANSFER_PENDING' }),
      makeRow({ callId: 'c3', customerName: '박철수', state: 'ENDED' }),
    ]);
    render(<OutboundQueueTable disableLiveData />);

    expect(screen.getAllByTestId(/^queue-row-/)).toHaveLength(3);
    expect(screen.getByText('김영수')).toBeInTheDocument();
    expect(screen.getByText('이민정')).toBeInTheDocument();
    expect(screen.getByText('박철수')).toBeInTheDocument();
  });

  it('maps state to the semantic badge class', () => {
    seed([makeRow({ callId: 'c1', state: 'TRANSFER_PENDING' })]);
    render(<OutboundQueueTable disableLiveData />);

    const row = screen.getByTestId('queue-row-c1');
    // TRANSFER_PENDING → escalate tone (red, semantic queue palette).
    const badge = within(row).getByText('대기중');
    for (const cls of BADGE_TONE_CLASS.escalate.split(' ')) {
      expect(badge).toHaveClass(cls);
    }
  });

  it('shows churn risk % when present and a dash when absent', () => {
    seed([
      makeRow({ callId: 'c1', churnRisk: 72 }),
      makeRow({ callId: 'c2', customerName: '이민정', churnRisk: null }),
    ]);
    render(<OutboundQueueTable disableLiveData />);

    expect(screen.getByText('72%')).toBeInTheDocument();
    const row2 = screen.getByTestId('queue-row-c2');
    expect(within(row2).getByText('—')).toBeInTheDocument();
  });

  it('highlights needs_agent rows', () => {
    seed([makeRow({ callId: 'c1', highlight: 'needs_agent' })]);
    render(<OutboundQueueTable disableLiveData />);

    const row = screen.getByTestId('queue-row-c1');
    expect(row).toHaveAttribute('data-highlight', 'needs_agent');
    expect(row).toHaveClass('bg-red-50');
  });

  it('updates the table when an onQueueUpdate message arrives', async () => {
    render(<OutboundQueueTable />);
    // Flush the initial fetchQueue() resolution (resolves to an empty snapshot).
    await act(async () => {});
    // Live wiring active: nothing seeded yet.
    expect(screen.queryByText('한지민')).not.toBeInTheDocument();
    expect(emitQueueUpdate).toBeTypeOf('function');

    act(() => {
      emitQueueUpdate!({
        summary,
        rows: [
          makeRow({ callId: 'c9', customerName: '한지민', state: 'TRANSFER_PENDING' }),
          makeRow({ callId: 'c10', customerName: '최유진' }),
        ],
      });
    });

    expect(screen.getAllByTestId(/^queue-row-/)).toHaveLength(2);
    expect(screen.getByText('한지민')).toBeInTheDocument();
    expect(screen.getByText('최유진')).toBeInTheDocument();
  });

  it('shows an empty-state message (not a blank body) when there are no rows', async () => {
    render(<OutboundQueueTable />);
    // Initial fetchQueue resolves to an empty snapshot → status ready, 0 rows.
    await act(async () => {});
    expect(screen.queryAllByTestId(/^queue-row-/)).toHaveLength(0);
    const empty = screen.getByTestId('queue-empty');
    expect(empty).toHaveTextContent('현재 진행 중인 콜이 없습니다.');
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<OutboundQueueTable />);
    unsubscribe.mockClear();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  // ── row → screen navigation (state-keyed drill-in) ─────────────────────────
  describe('row navigation', () => {
    it('routes the 박서준 pre-analysis row to the segment screen', () => {
      seed([
        makeRow({
          callId: 'c-demo-01',
          customerName: '박서준',
          state: 'DIALING',
          stage: '사전 분석중',
        }),
      ]);
      render(<OutboundQueueTable disableLiveData />);
      fireEvent.click(screen.getByTestId('queue-row-c-demo-01'));
      expect(push).toHaveBeenCalledWith('/segment/cust-001');
    });

    // 데모 쇼케이스 행은 callId 로 고정 라우팅 — 배포 백엔드의 stage 문자열이
    // 시드 원본과 달라져도(예: '사전 고객분석') 세그먼트 화면을 거쳐야 한다.
    it('routes the c-demo-01 showcase row to /segment even when stage has drifted', () => {
      seed([
        makeRow({
          callId: 'c-demo-01',
          customerName: '박서준',
          state: 'DIALING',
          stage: '사전 고객분석',
        }),
      ]);
      render(<OutboundQueueTable disableLiveData />);
      fireEvent.click(screen.getByTestId('queue-row-c-demo-01'));
      expect(push).toHaveBeenCalledWith('/segment/cust-001');
    });

    it('routes an ENDED row to its CRM summary', () => {
      seed([makeRow({ callId: 'c5', customerName: '한지민', state: 'ENDED', stage: '상담 완료' })]);
      render(<OutboundQueueTable disableLiveData />);
      fireEvent.click(screen.getByTestId('queue-row-c5'));
      expect(push).toHaveBeenCalledWith('/crm/c5');
    });

    it('routes IN_CALL and DIALING rows to the consult screen', () => {
      seed([
        makeRow({ callId: 'c1', state: 'IN_CALL', stage: '우려 풀기' }),
        makeRow({ callId: 'c2', state: 'DIALING', stage: '신규 상담' }),
      ]);
      render(<OutboundQueueTable disableLiveData />);
      fireEvent.click(screen.getByTestId('queue-row-c1'));
      fireEvent.click(screen.getByTestId('queue-row-c2'));
      expect(push).toHaveBeenCalledWith('/calls/c1');
      expect(push).toHaveBeenCalledWith('/calls/c2');
    });

    it('routes 체험(experience) rows (exp-*) to the LIVE consult screen', () => {
      // 체험 큐 행은 mock 시나리오 재생이 아니라 실제 라이브 세션으로 진입한다(?live=1).
      seed([makeRow({ callId: 'exp-1782219685345', state: 'DIALING', stage: '발신 대기' })]);
      render(<OutboundQueueTable disableLiveData />);
      fireEvent.click(screen.getByTestId('queue-row-exp-1782219685345'));
      expect(push).toHaveBeenCalledWith('/calls/exp-1782219685345?live=1');
    });

    it('does not navigate a TRANSFER_PENDING (상담원 연결 대기) row', () => {
      seed([
        makeRow({ callId: 'c4', state: 'TRANSFER_PENDING', stage: '연결 대기' }),
      ]);
      render(<OutboundQueueTable disableLiveData />);
      const row = screen.getByTestId('queue-row-c4');
      expect(row).toHaveAttribute('data-navigable', 'false');
      fireEvent.click(row);
      expect(push).not.toHaveBeenCalled();
    });

    it('navigates on Enter key for an accessible row', () => {
      seed([makeRow({ callId: 'c5', state: 'ENDED', stage: '상담 완료' })]);
      render(<OutboundQueueTable disableLiveData />);
      fireEvent.keyDown(screen.getByTestId('queue-row-c5'), { key: 'Enter' });
      expect(push).toHaveBeenCalledWith('/crm/c5');
    });
  });
});
