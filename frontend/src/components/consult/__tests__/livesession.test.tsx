// LiveSession 단위 테스트 — 마이크 권한, onTurn 트랜스크립트 렌더, mock 시뮬레이션.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LiveSession } from '@/components/consult/LiveSession';

// onTurn 구독을 손으로 구동할 수 있게 콜백을 보관.
let emitTurn: ((t: { seq: number; speaker: string; text: string; audioUrl?: string | null }) => void) | null = null;
const startAudio = vi.fn().mockResolvedValue(true);
const audioChunk = vi.fn().mockResolvedValue(true);

let emitEnded: (() => void) | null = null;

vi.mock('@/lib/appsync', () => ({
  startAudio: (...a: unknown[]) => startAudio(...a),
  audioChunk: (...a: unknown[]) => audioChunk(...a),
  subscribeTurns: (_callId: string, onData: (t: unknown) => void) => {
    emitTurn = onData as typeof emitTurn;
    return () => { emitTurn = null; };
  },
  subscribeCallEnded: (_callId: string, onData: () => void) => {
    emitEnded = onData;
    return () => { emitEnded = null; };
  },
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const stopCapture = vi.fn();
// startPcmCapture에 넘어온 옵션(특히 함수형 vadThreshold)을 캡처해 슬라이더 연동 검증.
let lastCaptureOpts: { vadThreshold?: number | (() => number) } | undefined;
vi.mock('@/lib/pcmCapture', () => ({
  startPcmCapture: (_s: unknown, _cb: unknown, opts?: { vadThreshold?: number | (() => number) }) => {
    lastCaptureOpts = opts;
    return { stop: stopCapture };
  },
}));

const getUserMedia = vi.fn();

beforeEach(() => {
  getUserMedia.mockReset().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
  startAudio.mockClear();
  audioChunk.mockClear();
  stopCapture.mockClear();
  push.mockClear();
  emitTurn = null;
  emitEnded = null;
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
});
afterEach(() => vi.clearAllMocks());

async function renderLive(callId = 'exp-1') {
  await act(async () => {
    render(<LiveSession callId={callId} />);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('LiveSession', () => {
  it('requests mic and starts the audio session on entry', async () => {
    await renderLive();
    // 봇 TTS 되먹임(echo) 자기-barge-in/유령 turn 방지 — AEC 등 오디오 제약 활성.
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    await waitFor(() => expect(startAudio).toHaveBeenCalledWith('exp-1'));
    expect(screen.getByTestId('live-session')).toHaveAttribute('data-mic-state', 'listening');
  });

  it('renders customer and bot bubbles from onTurn', async () => {
    vi.useFakeTimers();
    await renderLive();
    await act(async () => {
      emitTurn?.({ seq: 1, speaker: 'customer', text: '여보세요?' });
      emitTurn?.({ seq: 2, speaker: 'bot', text: '안녕하세요, 현대캐피탈입니다.' });
    });
    // bot 텍스트는 타자기로 점진 노출 — 타이머를 끝까지 돌려 전체 텍스트 완성.
    await act(async () => { vi.runAllTimers(); });
    expect(screen.getByTestId('live-bubble-customer')).toHaveTextContent('여보세요?');
    expect(screen.getByTestId('live-bubble-bot')).toHaveTextContent('현대캐피탈');
    vi.useRealTimers();
  });

  it('dedupes re-emitted turns by seq', async () => {
    await renderLive();
    await act(async () => {
      emitTurn?.({ seq: 1, speaker: 'customer', text: '여보세요?' });
      emitTurn?.({ seq: 1, speaker: 'customer', text: '여보세요?' });
    });
    expect(screen.getAllByTestId('live-bubble-customer')).toHaveLength(1);
  });

  it('shows denied state and a retry button when mic is refused', async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
    await renderLive();
    await waitFor(() =>
      expect(screen.getByTestId('live-session')).toHaveAttribute('data-mic-state', 'denied'),
    );
    expect(screen.getByTestId('live-retry')).toBeInTheDocument();
    expect(startAudio).not.toHaveBeenCalled();
  });

  it('shows the green ✓ end button on onCallEnded and routes to CRM on click', async () => {
    await renderLive('exp-9');
    // 통화 종료 이벤트 전에는 종료 버튼 없음.
    expect(screen.queryByTestId('live-ended-crm')).not.toBeInTheDocument();
    await act(async () => { emitEnded?.(); });
    const endBtn = screen.getByTestId('live-ended-crm');
    expect(endBtn).toBeInTheDocument();
    expect(screen.getByTestId('live-session')).toHaveTextContent('상담 종료');
    endBtn.click();
    expect(push).toHaveBeenCalledWith('/crm/exp-9');
  });

  it('VAD 감도 슬라이더: listening 중 노출, 기본 0.110, 함수형 임계값으로 전달', async () => {
    await renderLive();
    const slider = screen.getByTestId('vad-threshold-slider') as HTMLInputElement;
    expect(slider).toBeInTheDocument();
    expect(screen.getByTestId('vad-threshold-value')).toHaveTextContent('0.110');
    // startPcmCapture는 함수형 vadThreshold를 받아 매 프레임 현재값을 읽어야 한다.
    expect(typeof lastCaptureOpts?.vadThreshold).toBe('function');
    expect((lastCaptureOpts!.vadThreshold as () => number)()).toBeCloseTo(0.11, 3);
  });

  it('슬라이더를 움직이면 임계값이 즉시(재시작 없이) 반영된다', async () => {
    await renderLive();
    const slider = screen.getByTestId('vad-threshold-slider');
    const getThreshold = lastCaptureOpts!.vadThreshold as () => number;
    await act(async () => {
      fireEvent.change(slider, { target: { value: '0.1' } });
    });
    expect(screen.getByTestId('vad-threshold-value')).toHaveTextContent('0.100');
    // 동일 함수가 갱신된 값을 반환(캡처 재시작 없음 → stopCapture 미호출).
    expect(getThreshold()).toBeCloseTo(0.1, 3);
    expect(stopCapture).not.toHaveBeenCalled();
  });

  it('통화 종료 후에는 슬라이더가 숨겨진다', async () => {
    await renderLive('exp-end');
    expect(screen.getByTestId('vad-threshold-control')).toBeInTheDocument();
    await act(async () => { emitEnded?.(); });
    expect(screen.queryByTestId('vad-threshold-control')).not.toBeInTheDocument();
  });

  describe('타이핑 인디케이터 + 타자기 스트리밍', () => {
    it('고객 턴 도착 시 "..." 인디케이터를 노출하고 bot 턴 도착 시 사라진다', async () => {
      await renderLive();
      await act(async () => { emitTurn?.({ seq: 1, speaker: 'customer', text: '여보세요?' }); });
      expect(screen.getByTestId('live-bubble-typing')).toBeInTheDocument();

      vi.useFakeTimers();
      await act(async () => { emitTurn?.({ seq: 2, speaker: 'bot', text: '안녕하세요.' }); });
      expect(screen.queryByTestId('live-bubble-typing')).not.toBeInTheDocument();
      await act(async () => { vi.runAllTimers(); });
      vi.useRealTimers();
    });

    it('bot 텍스트를 타자기로 한 글자씩 노출해 완료 시 전체 텍스트가 보인다', async () => {
      vi.useFakeTimers();
      await renderLive();
      await act(async () => {
        emitTurn?.({ seq: 1, speaker: 'customer', text: '여보세요?' });
        emitTurn?.({ seq: 2, speaker: 'bot', text: 'ABCDEFG' });
      });
      await act(async () => { vi.runAllTimers(); });
      expect(screen.getByTestId('live-bubble-bot')).toHaveTextContent('ABCDEFG');
      vi.useRealTimers();
    });

    it('MODIFY 재발화(같은 seq + audioUrl)는 타자기를 재시작하거나 말풍선을 복제하지 않는다', async () => {
      vi.useFakeTimers();
      await renderLive();
      await act(async () => {
        emitTurn?.({ seq: 1, speaker: 'customer', text: '여보세요?' });
        emitTurn?.({ seq: 2, speaker: 'bot', text: '안녕하세요.' });
      });
      await act(async () => { vi.runAllTimers(); }); // reveal 완료
      // 백엔드 MODIFY: 같은 seq에 audioUrl만 추가되어 재발화.
      await act(async () => { emitTurn?.({ seq: 2, speaker: 'bot', text: '안녕하세요.', audioUrl: 'https://x/a.mp3' }); });
      await act(async () => { vi.runAllTimers(); });
      expect(screen.getAllByTestId('live-bubble-bot')).toHaveLength(1);
      expect(screen.getByTestId('live-bubble-bot')).toHaveTextContent('안녕하세요.');
      vi.useRealTimers();
    });
  });
});
