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
// startSileroCapture에 넘어온 옵션(함수형 positiveSpeechThreshold + 발화 시작/종료 훅)을
// 캡처해 슬라이더 연동/"음성 인식 중" 말풍선 검증에 쓴다. Silero는 모델 로드가 비동기라
// startSileroCapture가 Promise<handle>을 반환한다 — 목도 동일하게 resolve한다.
let lastCaptureOpts:
  | { positiveSpeechThreshold?: number | (() => number); onSpeechStart?: () => void; onSpeechEnd?: () => void }
  | undefined;
// onChunk(b64) 콜백도 캡처 — 발화 1건이 STT로 전송되는 순간을 흉내 내(recognizing on)
// 발화 종료~텍스트 확정 사이 "음성 인식 중" 유지 검증에 쓴다.
let lastChunkCb: ((b64: string) => void) | undefined;
vi.mock('@/lib/sileroCapture', () => ({
  startSileroCapture: async (
    _s: unknown,
    cb: (b64: string) => void,
    opts?: { positiveSpeechThreshold?: number | (() => number); onSpeechStart?: () => void; onSpeechEnd?: () => void },
  ) => {
    lastCaptureOpts = opts;
    lastChunkCb = cb;
    return { stop: stopCapture };
  },
}));

// DeepFilterNet denoise는 WASM/AudioContext 의존 — jsdom에 없으므로 목으로 대체.
// 원본 스트림을 그대로 통과시키는 패스스루 handle을 돌려준다(enhanced=false).
const stopDfn = vi.fn();
vi.mock('@/lib/dfnDenoise', () => ({
  startDfnDenoise: async (stream: MediaStream) => ({ stream, enhanced: false, stop: stopDfn }),
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
    // 표준 3종은 필수, 추가 강화 힌트(google*/voiceIsolation)는 best-effort라 허용.
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }),
    });
    await waitFor(() => expect(startAudio).toHaveBeenCalledWith('exp-1', undefined));
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

  it('VAD 감도 슬라이더: listening 중 노출, 기본 0.50, 함수형 발화확률 임계값으로 전달', async () => {
    await renderLive();
    const slider = screen.getByTestId('vad-threshold-slider') as HTMLInputElement;
    expect(slider).toBeInTheDocument();
    // Silero 발화 확률 기본 0.50(소수 2자리 표기).
    expect(screen.getByTestId('vad-threshold-value')).toHaveTextContent('0.50');
    // startSileroCapture는 함수형 positiveSpeechThreshold를 받아 생성 시점 현재값을 읽는다.
    expect(typeof lastCaptureOpts?.positiveSpeechThreshold).toBe('function');
    expect((lastCaptureOpts!.positiveSpeechThreshold as () => number)()).toBeCloseTo(0.5, 2);
  });

  it('슬라이더를 움직이면 임계값이 (재시작 없이) ref에 반영된다', async () => {
    await renderLive();
    const slider = screen.getByTestId('vad-threshold-slider');
    const getThreshold = lastCaptureOpts!.positiveSpeechThreshold as () => number;
    await act(async () => {
      fireEvent.change(slider, { target: { value: '0.3' } });
    });
    expect(screen.getByTestId('vad-threshold-value')).toHaveTextContent('0.30');
    // 동일 함수가 갱신된 ref 값을 반환(캡처 재생성 없음 → stopCapture 미호출).
    expect(getThreshold()).toBeCloseTo(0.3, 2);
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

    it('VAD 발화 시작 시 "음성 인식 중" 말풍선 노출, 고객 턴 확정 시 사라진다', async () => {
      await renderLive();
      // 발화 시작 전에는 listening 말풍선 없음.
      expect(screen.queryByTestId('live-bubble-listening')).not.toBeInTheDocument();
      // VAD speech-start → "음성 인식 중" 노출.
      await act(async () => { lastCaptureOpts?.onSpeechStart?.(); });
      expect(screen.getByTestId('live-bubble-listening')).toBeInTheDocument();
      expect(screen.getByTestId('live-bubble-listening')).toHaveTextContent('음성 인식 중');
      // onTurn(customer)으로 텍스트 확정 → listening 사라지고 실제 고객 말풍선 + "발화 준비 중".
      await act(async () => { emitTurn?.({ seq: 1, speaker: 'customer', text: '여보세요?' }); });
      expect(screen.queryByTestId('live-bubble-listening')).not.toBeInTheDocument();
      expect(screen.getByTestId('live-bubble-customer')).toHaveTextContent('여보세요?');
      expect(screen.getByTestId('live-bubble-typing')).toHaveTextContent('발화 준비 중');
    });

    it('VAD 발화 종료(onSpeechEnd) 시 "음성 인식 중" 말풍선이 사라진다', async () => {
      await renderLive();
      await act(async () => { lastCaptureOpts?.onSpeechStart?.(); });
      expect(screen.getByTestId('live-bubble-listening')).toBeInTheDocument();
      await act(async () => { lastCaptureOpts?.onSpeechEnd?.(); });
      expect(screen.queryByTestId('live-bubble-listening')).not.toBeInTheDocument();
    });

    it('STT 처리중(청크 전송~텍스트 확정)에는 발화 종료 후에도 "음성 인식 중"이 유지되고 대기 화면이 돌아오지 않는다', async () => {
      await renderLive();
      // 발화 시작 → 청크 전송(STT로 보냄) → 발화 종료. 텍스트는 아직 미확정.
      await act(async () => { lastCaptureOpts?.onSpeechStart?.(); });
      await act(async () => { lastChunkCb?.('AAAA'); });
      await act(async () => { lastCaptureOpts?.onSpeechEnd?.(); });
      // userSpeaking이 내려갔어도 recognizing이 유지 → "음성 인식 중" 버블 + 대기 화면 미복귀.
      expect(screen.getByTestId('live-bubble-listening')).toBeInTheDocument();
      expect(screen.queryByText(/연결되었습니다/)).not.toBeInTheDocument();
      // 고객 텍스트 확정 → 인식 버블 사라지고 실제 고객 말풍선.
      await act(async () => { emitTurn?.({ seq: 1, speaker: 'customer', text: '여보세요?' }); });
      expect(screen.queryByTestId('live-bubble-listening')).not.toBeInTheDocument();
      expect(screen.getByTestId('live-bubble-customer')).toHaveTextContent('여보세요?');
    });
  });

  describe('통화 연결중 오버레이', () => {
    it('진입 시 "통화 연결중" 오버레이 + 3초 카운트다운을 보이고 3초 후 사라진다', async () => {
      vi.useFakeTimers();
      try {
        await act(async () => {
          render(<LiveSession callId="exp-conn" />);
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(screen.getByTestId('live-connecting-overlay')).toBeInTheDocument();
        expect(screen.getByTestId('live-connecting-countdown')).toHaveTextContent('3');
        // 1초씩 카운트다운.
        await act(async () => { vi.advanceTimersByTime(1000); });
        expect(screen.getByTestId('live-connecting-countdown')).toHaveTextContent('2');
        await act(async () => { vi.advanceTimersByTime(1000); });
        expect(screen.getByTestId('live-connecting-countdown')).toHaveTextContent('1');
        // 3초 경과 → 오버레이 제거.
        await act(async () => { vi.advanceTimersByTime(1000); });
        expect(screen.queryByTestId('live-connecting-overlay')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
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
