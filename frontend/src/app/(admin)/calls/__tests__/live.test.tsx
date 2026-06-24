// 라이브 모드 진입 테스트 — ?live=1 시 mock 엔진 대신 LiveSession(마이크 패널) 렌더.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import ConsultCockpitPage from '@/app/(admin)/calls/[id]/page';

vi.mock('@/lib/appsync', () => ({
  subscribeSpeechAnalysis: () => () => {},
  subscribeStrategyUpdate: () => () => {},
  subscribeComplianceState: () => () => {},
  subscribeMotDetected: () => () => {},
  subscribeIndexUpdate: () => () => {},
  subscribeTurns: () => () => {},
  subscribeCallEnded: () => () => {},
  fetchMots: () => Promise.resolve([]),
  // 라이브 오디오 뮤테이션 — LiveSession이 마이크 권한 후 호출.
  startAudio: vi.fn().mockResolvedValue(true),
  audioChunk: vi.fn().mockResolvedValue(true),
}));

// PCM 캡처는 AudioContext 의존 — jsdom에 없으므로 목으로 대체.
vi.mock('@/lib/pcmCapture', () => ({
  startPcmCapture: () => ({ stop: vi.fn() }),
}));

vi.mock('@/stores/motStore', () => {
  const MOT_MARKER_IDS = ['rz-rate', 'rz-compare', 'rz-pay', 'rz-security', 'rz-avoid'];
  return {
    MOT_MARKER_IDS,
    useMotStore: () => ({
      mots: [], markers: MOT_MARKER_IDS.map((id: string) => ({ id, state: 'hidden' })),
      activeCautionSeq: null, addMot: vi.fn(), setMarkerState: vi.fn(),
      showCaution: vi.fn(), hideCaution: vi.fn(), reset: vi.fn(),
    }),
  };
});

// ?live=1 으로 진입.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('live=1'),
}));

// getUserMedia 목 — 권한 허용 시나리오.
const getUserMedia = vi.fn().mockResolvedValue({
  getTracks: () => [{ stop: vi.fn() }],
});

beforeEach(() => {
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  getUserMedia.mockClear();
});
afterEach(() => vi.clearAllMocks());

const mockParams = () => Promise.resolve({ id: 'exp-123' });

async function renderLive() {
  await act(async () => {
    render(<ConsultCockpitPage params={mockParams()} />);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ConsultCockpitPage — live mode (?live=1)', () => {
  it('renders the LiveSession mic panel instead of the play/pause control', async () => {
    await renderLive();
    expect(screen.getByTestId('live-session')).toBeInTheDocument();
    // mock 시나리오 재생 컨트롤(원형 버튼)은 라이브 모드에서 없어야 한다.
    expect(screen.queryByTestId('call-button')).not.toBeInTheDocument();
    expect(document.querySelector('#next')).toBeNull();
  });

  it('requests microphone access on entry', async () => {
    await renderLive();
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  });

  it('shows the 여보세요 waiting prompt once mic is granted', async () => {
    await renderLive();
    // getUserMedia 가 resolve된 뒤 listening 상태로 전환.
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('live-session')).toHaveAttribute('data-mic-state', 'listening');
    expect(screen.getByText(/여보세요/)).toBeInTheDocument();
  });
});
