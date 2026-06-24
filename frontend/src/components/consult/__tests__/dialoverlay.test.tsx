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

  it('answered=true 가 되면 폴백 타이머보다 먼저 연결됨 → onConnected 호출', () => {
    const onConnected = vi.fn();
    const { rerender } = render(
      <DialOverlay customerName="박서준 고객" onConnected={onConnected} answered={false} />,
    );

    // 아직 카운트다운 중. 고객 수신 신호 도착.
    act(() => vi.advanceTimersByTime(800));
    rerender(<DialOverlay customerName="박서준 고객" onConnected={onConnected} answered={true} />);

    // 즉시 '연결됨 ✓' 로 점프.
    expect(screen.getByTestId('dial-count')).toHaveTextContent('연결됨');

    // 짧은 확인(700ms) 후 전환 — 폴백 타이머(5100ms) 도달 전.
    expect(onConnected).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(700));
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it('answered 와 폴백 타이머가 경쟁해도 onConnected 는 한 번만 호출', () => {
    const onConnected = vi.fn();
    const { rerender } = render(
      <DialOverlay customerName="박서준 고객" onConnected={onConnected} answered={false} />,
    );

    // 폴백 타임라인 전체 경과 → onConnected 1회.
    act(() => vi.advanceTimersByTime(5100));
    expect(onConnected).toHaveBeenCalledTimes(1);

    // 이후 뒤늦게 수신 신호가 와도 중복 호출 없음.
    rerender(<DialOverlay customerName="박서준 고객" onConnected={onConnected} answered={true} />);
    act(() => vi.advanceTimersByTime(700));
    expect(onConnected).toHaveBeenCalledTimes(1);
  });
});
