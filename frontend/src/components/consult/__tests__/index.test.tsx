// RTL tests for FRONTEND-012 (이탈위험/감정 게이지)
// Acceptance criteria:
//   1. churn 62% → bannerDist text & rz marker risk-active emphasis
//   2. emotion value → 감정 bin (EMOTION) label
//   3. No standalone IndexGauge DOM (SSOT 정합)
//   4. onIndexUpdate mock → store update; unmount → unsubscribe called
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { JourneyMap } from '@/components/consult/JourneyMap';
import { SpeechAnalysis } from '@/components/consult/SpeechAnalysis';
import type { IndexUpdate } from '@/types/realtime';
import { useMotStore } from '@/stores/motStore';

// ── Mock AppSync ──────────────────────────────────────────────────────────────
// Both JourneyMap and SpeechAnalysis subscribe to subscribeIndexUpdate.
// We capture the last registered onData for each subscription.
let emitIndex: ((idx: IndexUpdate) => void) | null = null;
const unsubIndex = vi.fn();

vi.mock('@/lib/appsync', () => ({
  // JourneyMap deps
  subscribeMotDetected: vi.fn().mockReturnValue(vi.fn()),
  fetchMots: vi.fn().mockResolvedValue([]),
  // SpeechAnalysis deps
  subscribeSpeechAnalysis: vi.fn().mockReturnValue(vi.fn()),
  subscribeStrategyUpdate: vi.fn().mockReturnValue(vi.fn()),
  // FRONTEND-012: shared — capture last subscriber
  subscribeIndexUpdate: (
    _callId: string,
    onData: (idx: IndexUpdate) => void,
  ) => {
    emitIndex = onData;
    return unsubIndex;
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeIndex(over: Partial<IndexUpdate> = {}): IndexUpdate {
  return {
    callId: 'call-1',
    churnRisk: 0,
    emotion: '중립',
    ...over,
  };
}

afterEach(() => {
  unsubIndex.mockReset();
  emitIndex = null;
  useMotStore.getState().reset();
});

// ── JourneyMap: churnRisk → data-churn-risk / rz risk-active ────────────────
// NavBanner(#banner)가 제거되어 churnRisk%는 더 이상 banner-dist로 표시되지 않는다.
// churnRisk는 이제 journey-map의 data-churn-risk 속성 + rz 마커 risk-active로만 관측된다.
describe('FRONTEND-012 — JourneyMap: churnRisk → data-churn-risk', () => {
  it('initialChurnRisk=62 → journey-map data-churn-risk="62"', () => {
    render(
      <JourneyMap callId="call-1" initialChurnRisk={62} disableLiveData />,
    );
    expect(screen.getByTestId('journey-map')).toHaveAttribute('data-churn-risk', '62');
  });

  it('initialChurnRisk=0 → journey-map data-churn-risk="0"', () => {
    render(
      <JourneyMap callId="call-1" initialChurnRisk={0} disableLiveData />,
    );
    expect(screen.getByTestId('journey-map')).toHaveAttribute('data-churn-risk', '0');
  });

  it('initialChurnRisk=62 → journey-map has data-churn-risk="62"', () => {
    render(
      <JourneyMap callId="call-1" initialChurnRisk={62} disableLiveData />,
    );
    const map = screen.getByTestId('journey-map');
    expect(map).toHaveAttribute('data-churn-risk', '62');
  });

  it('churnRisk >= 50 → all non-blocked rz markers have data-risk-active="true"', () => {
    render(
      <JourneyMap callId="call-1" initialChurnRisk={62} disableLiveData />,
    );
    const markers = screen.getAllByTestId(/^mot-marker-/);
    for (const marker of markers) {
      const state = marker.getAttribute('data-marker-state');
      if (state !== 'blocked') {
        expect(marker).toHaveAttribute('data-risk-active', 'true');
      }
    }
  });

  it('churnRisk < 50 → rz markers do NOT have data-risk-active', () => {
    render(
      <JourneyMap callId="call-1" initialChurnRisk={30} disableLiveData />,
    );
    const markers = screen.getAllByTestId(/^mot-marker-/);
    for (const marker of markers) {
      expect(marker).not.toHaveAttribute('data-risk-active', 'true');
    }
  });

  it('live onIndexUpdate emission → data-churn-risk updates to 62', () => {
    render(<JourneyMap callId="call-1" />);
    expect(emitIndex).toBeTypeOf('function');

    act(() => emitIndex!(makeIndex({ churnRisk: 62 })));
    expect(screen.getByTestId('journey-map')).toHaveAttribute('data-churn-risk', '62');
  });

  it('onIndexUpdate mock → multiple updates reflect latest value', () => {
    render(<JourneyMap callId="call-1" />);

    act(() => emitIndex!(makeIndex({ churnRisk: 20 })));
    expect(screen.getByTestId('journey-map')).toHaveAttribute('data-churn-risk', '20');

    act(() => emitIndex!(makeIndex({ churnRisk: 75 })));
    expect(screen.getByTestId('journey-map')).toHaveAttribute('data-churn-risk', '75');
  });

  it('unmount → unsubscribe called (subscription cleanup)', () => {
    const { unmount } = render(<JourneyMap callId="call-1" />);
    unsubIndex.mockClear();
    unmount();
    // subscribeIndexUpdate unsubscribe must have been called
    expect(unsubIndex).toHaveBeenCalled();
  });
});

// ── SpeechAnalysis: emotion → EMOTION bin ───────────────────────────────────
describe('FRONTEND-012 — SpeechAnalysis: emotion → EMOTION bin', () => {
  it('renders the 3 SSOT bins (감정/니즈/이용가능성) in #emoBins', () => {
    render(<SpeechAnalysis callId="c1" disableLiveData />);
    const bins = screen.getByTestId('emo-bins');
    expect(bins).toBeInTheDocument();
    expect(screen.getByTestId('emo-bin-emotion')).toBeInTheDocument();
    expect(screen.getByTestId('emo-bin-needs')).toBeInTheDocument();
    expect(screen.getByTestId('emo-bin-availability')).toBeInTheDocument();
  });

  it('initialEmotion="불안" → EMOTION bin orb shows "불안"', () => {
    render(
      <SpeechAnalysis callId="c1" initialEmotion="불안" disableLiveData />,
    );
    const orb = screen.getByTestId('emo-emotion-orb');
    expect(orb).toBeInTheDocument();
    expect(orb).toHaveTextContent('불안');
  });

  it('initialEmotion=null → no emotion orb in EMOTION bin', () => {
    render(<SpeechAnalysis callId="c1" disableLiveData />);
    expect(screen.queryByTestId('emo-emotion-orb')).not.toBeInTheDocument();
  });

  it('live onIndexUpdate emission → EMOTION bin shows new label', () => {
    render(<SpeechAnalysis callId="c1" />);
    expect(emitIndex).toBeTypeOf('function');

    act(() => emitIndex!(makeIndex({ callId: 'c1', emotion: '관심', churnRisk: 30 })));
    expect(screen.getByTestId('emo-emotion-orb')).toHaveTextContent('관심');
  });

  it('emotion updates overwrite previous label', () => {
    render(<SpeechAnalysis callId="c1" />);

    act(() => emitIndex!(makeIndex({ callId: 'c1', emotion: '경계', churnRisk: 55 })));
    expect(screen.getByTestId('emo-emotion-orb')).toHaveTextContent('경계');

    act(() => emitIndex!(makeIndex({ callId: 'c1', emotion: '관심', churnRisk: 20 })));
    expect(screen.getByTestId('emo-emotion-orb')).toHaveTextContent('관심');
  });

  it('EMOTION bin bin__h label text is "감정"', () => {
    render(<SpeechAnalysis callId="c1" disableLiveData />);
    const emotionBin = screen.getByTestId('emo-bin-emotion');
    expect(emotionBin.querySelector('.bin__h b')).toHaveTextContent('감정');
  });

  it('unmount → subscribeIndexUpdate unsubscribe called', () => {
    const { unmount } = render(<SpeechAnalysis callId="c1" />);
    unsubIndex.mockClear();
    unmount();
    expect(unsubIndex).toHaveBeenCalled();
  });
});

// ── SSOT 정합: No IndexGauge DOM ─────────────────────────────────────────────
describe('FRONTEND-012 — SSOT 정합: IndexGauge 미존재', () => {
  it('JourneyMap renders NO standalone IndexGauge widget', () => {
    render(<JourneyMap callId="call-1" initialChurnRisk={62} disableLiveData />);
    // SSOT 주석: "게이지 위젯은 제거" — no IndexGauge DOM should exist
    expect(document.querySelector('[data-testid="index-gauge"]')).not.toBeInTheDocument();
    expect(document.querySelector('.index-gauge')).not.toBeInTheDocument();
    expect(document.querySelector('#index-gauge')).not.toBeInTheDocument();
    expect(document.querySelector('[class*="IndexGauge"]')).not.toBeInTheDocument();
  });

  it('SpeechAnalysis renders NO standalone IndexGauge widget', () => {
    render(<SpeechAnalysis callId="c1" initialEmotion="불안" disableLiveData />);
    expect(document.querySelector('[data-testid="index-gauge"]')).not.toBeInTheDocument();
    expect(document.querySelector('.index-gauge')).not.toBeInTheDocument();
    expect(document.querySelector('#index-gauge')).not.toBeInTheDocument();
    expect(document.querySelector('[class*="IndexGauge"]')).not.toBeInTheDocument();
  });

  it('churnRisk is expressed ONLY via data-churn-risk and rz markers — not a separate gauge', () => {
    render(<JourneyMap callId="call-1" initialChurnRisk={62} disableLiveData />);
    // The value appears on journey-map data attribute (NavBanner 제거됨)
    expect(screen.getByTestId('journey-map')).toHaveAttribute('data-churn-risk', '62');
    // No separate gauge-specific elements
    expect(document.querySelector('[role="meter"]')).not.toBeInTheDocument();
    expect(document.querySelector('[aria-label*="gauge"]')).not.toBeInTheDocument();
  });
});
