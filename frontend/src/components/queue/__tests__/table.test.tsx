// RTL tests for OutboundQueueTable (FRONTEND-001 / #30 Acceptance).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import { OutboundQueueTable } from '@/components/queue/OutboundQueueTable';
import { BADGE_TONE_CLASS } from '@/components/ui/Badge';
import { useQueueStore } from '@/stores/queueStore';
import type { QueueResult, QueueRow } from '@/types/queue';

// Mock the AppSync layer so we can drive the onQueueUpdate stream by hand.
const emptyResult: QueueResult = {
  summary: { waiting: 0, inProgress: 0, needsAgent: 0, fraudSuspected: 0, ended: 0 },
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

function makeRow(over: Partial<QueueRow> = {}): QueueRow {
  return {
    callId: 'c1',
    customerId: 'cust1',
    customerName: '김영수',
    targetProduct: '대환대출',
    state: 'IN_CALL',
    scenario: 'S1',
    highlight: null,
    highlightSince: null,
    elapsedSec: 95,
    ...over,
  };
}

const summary = { waiting: 0, inProgress: 1, needsAgent: 0, fraudSuspected: 0, ended: 0 };

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
    const badge = within(row).getByText('상담원 연결 대기');
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

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<OutboundQueueTable />);
    unsubscribe.mockClear();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
