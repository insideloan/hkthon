// RTL tests for SegmentPage (FRONTEND-003 / #32 Acceptance).
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Mock next/navigation (needed by CallButton)
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Mock appsync — all ops controlled per test
const createCallMock = vi.fn();
const fetchCustomerMock = vi.fn();
const dialCallMock = vi.fn();
vi.mock('@/lib/appsync', () => ({
  createCall: (...args: unknown[]) => createCallMock(...args),
  fetchCustomer: (...args: unknown[]) => fetchCustomerMock(...args),
  dialCall: (...args: unknown[]) => dialCallMock(...args),
}));

// Import page after mocks are wired up
import SegmentPage from '@/app/(admin)/segment/[customerId]/page';

const MOCK_CUSTOMER = {
  customerId: 'cust-001',
  name: '박서준',
  age: 42,
  phone: '010-****-2840',
  targetProduct: '자동차 담보대출',
};

const MOCK_CALL = { callId: 'call-abc', state: 'CREATED' };

beforeEach(() => {
  vi.clearAllMocks();
  createCallMock.mockResolvedValue(MOCK_CALL);
  fetchCustomerMock.mockResolvedValue(MOCK_CUSTOMER);
});

afterEach(() => {
  vi.useRealTimers();
});

// Helper: render and wait for async init (Promise.all) to settle, without fake timers
async function renderAndAwaitInit(customerId = 'cust-001') {
  let view: ReturnType<typeof render>;
  await act(async () => {
    view = render(<SegmentPage params={Promise.resolve({ customerId })} />);
    // Flush microtasks so the useEffect async init runs
    await Promise.resolve();
    await Promise.resolve();
  });
  return view!;
}

describe('SegmentPage', () => {
  it('calls createCall mutation on mount with customerId', async () => {
    await renderAndAwaitInit('cust-001');
    expect(createCallMock).toHaveBeenCalledWith('cust-001');
  });

  it('calls fetchCustomer query on mount', async () => {
    await renderAndAwaitInit('cust-001');
    expect(fetchCustomerMock).toHaveBeenCalledWith('cust-001');
  });

  it('shows call button when analysis is complete', async () => {
    vi.useFakeTimers();
    await renderAndAwaitInit('cust-001');
    // Advance past the full reveal timeline (completes at 3500ms → analysisComplete).
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.getByTestId('call-button')).toBeInTheDocument();
  });

  it('does NOT show call button when analysis is incomplete', async () => {
    vi.useFakeTimers();
    await renderAndAwaitInit('cust-001');
    // Don't advance timers — analysis not yet complete
    expect(screen.queryByTestId('call-button')).not.toBeInTheDocument();
  });

  it('does not dial on mount (createCall is analysis-only)', async () => {
    await renderAndAwaitInit('cust-001');
    expect(dialCallMock).not.toHaveBeenCalled();
  });

  it('renders customer name and product after load', async () => {
    await renderAndAwaitInit('cust-001');
    expect(screen.getByText(/박서준/)).toBeInTheDocument();
    expect(screen.getByText(/자동차 담보대출/)).toBeInTheDocument();
  });
});
