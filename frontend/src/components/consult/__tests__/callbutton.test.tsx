// RTL tests for CallButton (FRONTEND-002 / #31 Acceptance).
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CallButton } from '@/components/consult/CallButton';

// Mock next/navigation
const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

// Mock appsync dialCall
const dialCallMock = vi.fn();
vi.mock('@/lib/appsync', () => ({
  dialCall: (...args: unknown[]) => dialCallMock(...args),
}));

beforeEach(() => {
  pushMock.mockReset();
  dialCallMock.mockReset();
});

describe('CallButton', () => {
  it('renders a button with 발신하기 label', () => {
    render(<CallButton customerId="cust-1" analysisComplete />);
    expect(screen.getByTestId('call-button')).toBeInTheDocument();
    expect(screen.getByTestId('call-button')).toHaveTextContent('발신하기');
  });

  it('does NOT call dialCall on mount (no auto-dial)', () => {
    render(<CallButton customerId="cust-1" analysisComplete />);
    expect(dialCallMock).not.toHaveBeenCalled();
  });

  it('calls dialCall mutation when button is clicked', async () => {
    dialCallMock.mockResolvedValue({ callId: 'call-1', state: 'DIALING' });
    render(<CallButton customerId="cust-1" analysisComplete />);
    fireEvent.click(screen.getByTestId('call-button'));
    await waitFor(() => expect(dialCallMock).toHaveBeenCalledWith('cust-1'));
  });

  it('navigates to /calls/[id] after dialCall resolves', async () => {
    dialCallMock.mockResolvedValue({ callId: 'call-1', state: 'DIALING' });
    render(<CallButton customerId="cust-1" analysisComplete />);
    fireEvent.click(screen.getByTestId('call-button'));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/calls/call-1'));
  });

  it('is disabled when analysisComplete is false', () => {
    render(<CallButton customerId="cust-1" analysisComplete={false} />);
    expect(screen.getByTestId('call-button')).toBeDisabled();
  });

  it('does NOT call dialCall when disabled (analysisComplete=false)', async () => {
    render(<CallButton customerId="cust-1" analysisComplete={false} />);
    fireEvent.click(screen.getByTestId('call-button'));
    // Wait a tick to confirm nothing async fires
    await new Promise((r) => setTimeout(r, 10));
    expect(dialCallMock).not.toHaveBeenCalled();
  });
});
