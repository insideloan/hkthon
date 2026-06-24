// RTL tests for JourneyMap (FRONTEND-009 / #38 Acceptance).
// Verifies SSOT alignment: rz marker state transitions, cautionPop, banner,
// and asserts NO arbitrary floating panel / RISK·CONVERSION type DOM exists.
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { JourneyMap } from '@/components/consult/JourneyMap';
import type { MotDetected } from '@/types/realtime';
import { useMotStore } from '@/stores/motStore';

// ── Mock AppSync ─────────────────────────────────────────────────────────────
let emitMot: ((m: MotDetected) => void) | null = null;
const unsubscribe = vi.fn();

vi.mock('@/lib/appsync', () => ({
  subscribeMotDetected: (
    _callId: string,
    onData: (m: MotDetected) => void,
  ) => {
    emitMot = onData;
    return unsubscribe;
  },
  fetchMots: vi.fn().mockResolvedValue([]),
}));

// ── helpers ──────────────────────────────────────────────────────────────────
function makeMot(over: Partial<MotDetected> = {}): MotDetected {
  return {
    callId: 'call-1',
    seq: 1,
    type: 'RISK',
    turnSeq: 3,
    churnBefore: 20,
    churnAfter: 45,
    triggers: ['거부'],
    strategy: { tactic: '비교 포지셔닝', headline: '비교로 전환' },
    outcome: null,
    narrative: null,
    ...over,
  };
}

afterEach(() => {
  unsubscribe.mockReset();
  emitMot = null;
  // Reset the store between tests
  useMotStore.getState().reset();
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('JourneyMap — MOT 마커 상태 전이', () => {
  it('renders all 5 SSOT rz markers in hidden state initially', () => {
    render(<JourneyMap callId="call-1" disableLiveData />);
    const markerIds = ['rz-rate', 'rz-compare', 'rz-pay', 'rz-security', 'rz-avoid'];
    for (const id of markerIds) {
      const marker = screen.getByTestId(`mot-marker-${id}`);
      expect(marker).toBeInTheDocument();
      expect(marker).toHaveAttribute('data-marker-state', 'hidden');
    }
  });

  it('marker transitions to alert state when MOT risk arrives (seq=1 → rz-rate)', () => {
    render(<JourneyMap callId="call-1" initialMots={[makeMot({ seq: 1 })]} disableLiveData />);

    const marker = screen.getByTestId('mot-marker-rz-rate');
    expect(marker).toHaveAttribute('data-marker-state', 'alert');
    // show + alert classes per SSOT
    expect(marker).toHaveClass('rz', 'show', 'alert');
    expect(marker).not.toHaveClass('blocked');
  });

  it('cautionPop is visible when marker is in alert state', () => {
    render(<JourneyMap callId="call-1" initialMots={[makeMot({ seq: 1 })]} disableLiveData />);

    const pop = screen.getByTestId('caution-pop');
    expect(pop).toHaveAttribute('data-visible', 'true');
    expect(pop).toHaveClass('show');
  });

  it('marker transitions to blocked after defense, cautionPop hidden', () => {
    const defended = makeMot({ seq: 1, outcome: 'defended' });
    render(<JourneyMap callId="call-1" initialMots={[defended]} disableLiveData />);

    const marker = screen.getByTestId('mot-marker-rz-rate');
    expect(marker).toHaveAttribute('data-marker-state', 'blocked');
    expect(marker).toHaveClass('rz', 'show', 'blocked');
    expect(marker).not.toHaveClass('alert');

    const pop = screen.getByTestId('caution-pop');
    expect(pop).toHaveAttribute('data-visible', 'false');
    expect(pop).not.toHaveClass('show');
  });

  it('show → alert → blocked full transition via live emission', () => {
    render(<JourneyMap callId="call-1" />);
    expect(emitMot).toBeTypeOf('function');

    // Risk arrives → alert
    act(() => emitMot!(makeMot({ seq: 2 })));
    const marker = screen.getByTestId('mot-marker-rz-compare');
    expect(marker).toHaveAttribute('data-marker-state', 'alert');

    // Defense arrives → blocked
    act(() => emitMot!(makeMot({ seq: 2, outcome: 'defended' })));
    expect(marker).toHaveAttribute('data-marker-state', 'blocked');
  });

  it('maps seq 1-5 to correct SSOT marker IDs', () => {
    const mots = [1, 2, 3, 4, 5].map((seq) => makeMot({ seq }));
    render(<JourneyMap callId="call-1" initialMots={mots} disableLiveData />);

    const expected = [
      [1, 'rz-rate'],
      [2, 'rz-compare'],
      [3, 'rz-pay'],
      [4, 'rz-security'],
      [5, 'rz-avoid'],
    ] as const;

    for (const [, id] of expected) {
      const marker = screen.getByTestId(`mot-marker-${id}`);
      expect(marker).toHaveAttribute('data-marker-state', 'alert');
    }
  });
});

describe('JourneyMap — onMotDetected 실시간 구독', () => {
  it('live onMotDetected emission activates marker', async () => {
    render(<JourneyMap callId="call-1" />);
    expect(emitMot).toBeTypeOf('function');

    act(() => emitMot!(makeMot({ seq: 3 })));

    const marker = screen.getByTestId('mot-marker-rz-pay');
    expect(marker).toHaveAttribute('data-marker-state', 'alert');
    expect(marker).toHaveClass('show', 'alert');

    const pop = screen.getByTestId('caution-pop');
    expect(pop).toHaveAttribute('data-visible', 'true');
  });

  it('live defense emission blocks marker and hides cautionPop', async () => {
    render(<JourneyMap callId="call-1" />);

    act(() => emitMot!(makeMot({ seq: 4 })));
    expect(screen.getByTestId('mot-marker-rz-security')).toHaveAttribute('data-marker-state', 'alert');

    act(() => emitMot!(makeMot({ seq: 4, outcome: 'defended' })));
    const marker = screen.getByTestId('mot-marker-rz-security');
    expect(marker).toHaveAttribute('data-marker-state', 'blocked');
    expect(screen.getByTestId('caution-pop')).toHaveAttribute('data-visible', 'false');
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<JourneyMap callId="call-1" />);
    unsubscribe.mockClear();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('JourneyMap — 배너 제거됨', () => {
  // NavBanner(#banner 오버레이)는 여정 화면에서 제거됨 — 더 이상 렌더되지 않는다.
  it('does NOT render the nav banner overlay on risk arrival', () => {
    render(<JourneyMap callId="call-1" initialMots={[makeMot({ seq: 1 })]} disableLiveData />);
    expect(screen.queryByTestId('journey-banner')).toBeNull();
    expect(screen.queryByTestId('banner-eyebrow')).toBeNull();
  });

  it('does NOT render the nav banner overlay on defense', () => {
    render(
      <JourneyMap callId="call-1" initialMots={[makeMot({ seq: 1, outcome: 'defended' })]} disableLiveData />,
    );
    expect(screen.queryByTestId('journey-banner')).toBeNull();
  });
});

describe('JourneyMap — SSOT 정합: 삭제된 요소 미존재', () => {
  it('does NOT render an arbitrary floating panel outside the SVG', () => {
    render(<JourneyMap callId="call-1" initialMots={[makeMot({ seq: 1 })]} disableLiveData />);

    // 삭제된 요소: 임의 위치 별도 클릭 플로팅 패널, RISK·CONVERSION 타입 카드
    expect(document.querySelector('[data-testid="mot-floating-panel"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-testid="mot-detail-card"]')).not.toBeInTheDocument();
  });

  it('does NOT render RISK/CONVERSION type split UI', () => {
    render(<JourneyMap callId="call-1" initialMots={[makeMot({ seq: 1 })]} disableLiveData />);
    // No elements with type=RISK or type=CONVERSION as separate cards
    expect(document.querySelector('[data-mot-type="RISK"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-mot-type="CONVERSION"]')).not.toBeInTheDocument();
  });

  it('does NOT render churnBefore/churnAfter/narrative/strategy/outcome detail fields', () => {
    render(
      <JourneyMap
        callId="call-1"
        initialMots={[
          makeMot({
            seq: 1,
            churnBefore: 30,
            churnAfter: 65,
            narrative: '고객이 강하게 거부',
            outcome: null,
          }),
        ]}
        disableLiveData
      />,
    );
    // SSOT에 없는 자유 상세 카드 필드
    expect(document.querySelector('[data-testid="mot-narrative"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-testid="mot-churn-before"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-testid="mot-churn-after"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-testid="mot-outcome"]')).not.toBeInTheDocument();
  });

  it('renders exactly 5 rz markers (no extras)', () => {
    render(<JourneyMap callId="call-1" disableLiveData />);
    const markers = screen.getAllByTestId(/^mot-marker-/);
    expect(markers).toHaveLength(5);
  });
});
