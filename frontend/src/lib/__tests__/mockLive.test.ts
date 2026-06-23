// mockLive 시뮬레이터 테스트 — exp-* 콜에 구독이 붙으면 스크립트 이벤트가 흐른다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMockLiveCall, subscribeMockLive, _resetMockLive } from '@/lib/mockLive';

afterEach(() => {
  _resetMockLive();
  vi.useRealTimers();
});

describe('mockLive', () => {
  it('treats only exp-* callIds as mock-live', () => {
    expect(isMockLiveCall('exp-123')).toBe(true);
    expect(isMockLiveCall('c-demo-01')).toBe(false);
    expect(isMockLiveCall('cust-001')).toBe(false);
  });

  it('emits scripted turn + speech + strategy + compliance events', async () => {
    vi.useFakeTimers();
    const turns: unknown[] = [];
    const speech: unknown[] = [];
    const strategy: unknown[] = [];
    const compliance: unknown[] = [];

    subscribeMockLive('exp-1', 'turn', (p) => turns.push(p));
    subscribeMockLive('exp-1', 'speech', (p) => speech.push(p));
    subscribeMockLive('exp-1', 'strategy', (p) => strategy.push(p));
    subscribeMockLive('exp-1', 'compliance', (p) => compliance.push(p));

    // 마이크로태스크로 스케줄된 runScript 실행.
    await Promise.resolve();
    // 스크립트 전체(최대 ~3.6s) 진행.
    await vi.advanceTimersByTimeAsync(4000);

    // 고객 "여보세요" + AI 인사 등 turn 다수.
    expect(turns.length).toBeGreaterThanOrEqual(2);
    expect((turns[0] as { text: string }).text).toBe('여보세요?');
    // 3카드 채널 모두 최소 1건.
    expect(speech.length).toBeGreaterThanOrEqual(1);
    expect(strategy.length).toBeGreaterThanOrEqual(1);
    expect(compliance.length).toBeGreaterThanOrEqual(1);
    expect((compliance[0] as { phase: string }).phase).toBe('approved');
  });

  it('unsubscribe stops delivery to that handler', async () => {
    vi.useFakeTimers();
    const turns: unknown[] = [];
    const unsub = subscribeMockLive('exp-2', 'turn', (p) => turns.push(p));
    unsub();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(4000);
    expect(turns).toHaveLength(0);
  });
});
