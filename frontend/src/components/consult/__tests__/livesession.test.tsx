// LiveSession 단위 테스트 — 마이크 권한, onTurn 트랜스크립트 렌더, mock 시뮬레이션.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { LiveSession } from '@/components/consult/LiveSession';

// onTurn 구독을 손으로 구동할 수 있게 콜백을 보관.
let emitTurn: ((t: { seq: number; speaker: string; text: string }) => void) | null = null;
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
vi.mock('@/lib/pcmCapture', () => ({
  startPcmCapture: () => ({ stop: stopCapture }),
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
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    await waitFor(() => expect(startAudio).toHaveBeenCalledWith('exp-1'));
    expect(screen.getByTestId('live-session')).toHaveAttribute('data-mic-state', 'listening');
  });

  it('renders customer and bot bubbles from onTurn', async () => {
    await renderLive();
    await act(async () => {
      emitTurn?.({ seq: 1, speaker: 'customer', text: '여보세요?' });
      emitTurn?.({ seq: 2, speaker: 'bot', text: '안녕하세요, 현대캐피탈입니다.' });
    });
    expect(screen.getByTestId('live-bubble-customer')).toHaveTextContent('여보세요?');
    expect(screen.getByTestId('live-bubble-bot')).toHaveTextContent('현대캐피탈');
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
});
