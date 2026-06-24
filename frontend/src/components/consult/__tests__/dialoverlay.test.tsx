// DialOverlay — 통화 연결 오버레이 타임라인 테스트.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { DialOverlay } from '@/components/consult/DialOverlay';

describe('DialOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the customer name and initial countdown', () => {
    render(<DialOverlay customerName="박서준 고객" onConnected={() => {}} />);
    expect(screen.getByTestId('dial-overlay')).toBeInTheDocument();
    expect(screen.getByText('박서준 고객')).toBeInTheDocument();
    expect(screen.getByTestId('dial-count')).toHaveTextContent('3');
  });

  it('progresses countdown → 발신 중 → 연결됨, then calls onConnected', () => {
    const onConnected = vi.fn();
    render(<DialOverlay customerName="박서준 고객" onConnected={onConnected} />);

    // 카운트다운 3 → 2 → 1
    expect(screen.getByTestId('dial-count')).toHaveTextContent('3');
    act(() => vi.advanceTimersByTime(800));
    expect(screen.getByTestId('dial-count')).toHaveTextContent('2');
    act(() => vi.advanceTimersByTime(800));
    expect(screen.getByTestId('dial-count')).toHaveTextContent('1');

    // 발신 중…
    act(() => vi.advanceTimersByTime(800));
    expect(screen.getByTestId('dial-status')).toHaveTextContent('발신 중…');

    // 연결됨 ✓
    act(() => vi.advanceTimersByTime(1500));
    expect(screen.getByTestId('dial-count')).toHaveTextContent('연결됨');
    expect(screen.getByTestId('dial-status')).toHaveTextContent('통화 연결됨');

    // 아직 전환 전 — onConnected 미호출
    expect(onConnected).not.toHaveBeenCalled();

    // 전환 시점에 onConnected 호출(상담 화면 이동)
    act(() => vi.advanceTimersByTime(1200));
    expect(onConnected).toHaveBeenCalledTimes(1);
  });
});
