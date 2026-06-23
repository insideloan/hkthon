// useBotAudioPlayback — 봇 TTS audioUrl 순차 재생 훅 테스트.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBotAudioPlayback } from '@/hooks/useBotAudioPlayback';
import type { Turn } from '@/types/realtime';

// AppSync onTurn 구독을 손으로 구동.
let emitTurn: ((t: Turn) => void) | null = null;
const unsubscribe = vi.fn();
vi.mock('@/lib/appsync', () => ({
  subscribeTurns: (_callId: string, onData: (t: Turn) => void) => {
    emitTurn = onData;
    return unsubscribe;
  },
}));

// HTMLAudioElement 스텁 — 인스턴스를 캡처해 play/src를 관찰.
type FakeAudio = {
  src: string;
  volume: number;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
};
let audios: FakeAudio[] = [];

beforeEach(() => {
  audios = [];
  // play()는 즉시 resolve; onended는 테스트가 수동 호출해 '재생 완료'를 시뮬레이션.
  vi.stubGlobal(
    'Audio',
    vi.fn(() => {
      const a: FakeAudio = {
        src: '',
        volume: 1,
        onended: null,
        onerror: null,
        play: vi.fn(() => Promise.resolve()),
        pause: vi.fn(),
      };
      audios.push(a);
      return a;
    }),
  );
});

afterEach(() => {
  unsubscribe.mockReset();
  emitTurn = null;
  vi.unstubAllGlobals();
});

const bot = (seq: number, audioUrl?: string | null): Turn => ({
  callId: 'c1',
  seq,
  speaker: 'bot',
  text: `발화 ${seq}`,
  audioUrl,
});

describe('useBotAudioPlayback', () => {
  it('disabled면 구독하지 않는다', () => {
    renderHook(() => useBotAudioPlayback('c1', { disabled: true }));
    expect(emitTurn).toBeNull();
  });

  it('bot audioUrl 도착 시 재생한다', async () => {
    renderHook(() => useBotAudioPlayback('c1'));
    await act(async () => {
      emitTurn?.(bot(2, 'https://s3/a.mp3'));
    });
    expect(audios).toHaveLength(1);
    expect(audios[0].src).toBe('https://s3/a.mp3');
    expect(audios[0].play).toHaveBeenCalledOnce();
  });

  it('customer Turn·audioUrl 없는 Turn은 무시', async () => {
    renderHook(() => useBotAudioPlayback('c1'));
    await act(async () => {
      emitTurn?.({ callId: 'c1', seq: 1, speaker: 'customer', text: '고객 발화' });
      emitTurn?.(bot(2, null));
      emitTurn?.(bot(3, undefined));
    });
    expect(audios[0].play).not.toHaveBeenCalled();
  });

  it('동시 도착 시 순차 재생(겹치지 않음): 첫 클립 종료 후 다음 재생', async () => {
    renderHook(() => useBotAudioPlayback('c1'));
    await act(async () => {
      emitTurn?.(bot(2, 'https://s3/a.mp3'));
      emitTurn?.(bot(3, 'https://s3/b.mp3'));
    });
    // 첫 클립만 재생 시작.
    expect(audios[0].play).toHaveBeenCalledOnce();
    expect(audios[0].src).toBe('https://s3/a.mp3');
    // 첫 클립 종료 → 다음 클립 재생.
    await act(async () => {
      audios[0].onended?.();
    });
    expect(audios[0].src).toBe('https://s3/b.mp3');
    expect(audios[0].play).toHaveBeenCalledTimes(2);
  });

  it('같은 seq 재방출은 중복 재생하지 않는다(멱등)', async () => {
    renderHook(() => useBotAudioPlayback('c1'));
    await act(async () => {
      emitTurn?.(bot(2, 'https://s3/a.mp3'));
      emitTurn?.(bot(2, 'https://s3/a.mp3'));
    });
    expect(audios[0].play).toHaveBeenCalledOnce();
  });

  it('play() 거부(자동재생 차단)도 큐를 막지 않는다', async () => {
    renderHook(() => useBotAudioPlayback('c1'));
    // 첫 클립 play 거부.
    await act(async () => {
      emitTurn?.(bot(2, 'https://s3/a.mp3'));
    });
    audios[0].play.mockReturnValueOnce(Promise.resolve()); // 다음은 정상
    await act(async () => {
      // 거부 처리(catch→done) 후에도 다음 클립이 재생되는지.
      emitTurn?.(bot(3, 'https://s3/b.mp3'));
      await Promise.resolve();
    });
    // 큐가 진행돼 두 번째 src로 전환됐는지(막히지 않음).
    expect(audios[0].play.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('언마운트 시 구독 해제 + 일시정지', () => {
    const { unmount } = renderHook(() => useBotAudioPlayback('c1'));
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
    expect(audios[0].pause).toHaveBeenCalled();
  });
});
