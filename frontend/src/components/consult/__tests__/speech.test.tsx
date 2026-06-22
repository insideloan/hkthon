// RTL tests for SpeechAnalysis — FRONTEND-004 (#33) Acceptance.
// · 키워드(.kw) 폰트 강조 클래스 적용 + 색상 클래스(k-go/k-risk) 미적용
// · 위험 턴 → .flag--risk 배지, 방어 턴 → .flag--def 배지
// · onSpeechAnalysis mock 이벤트 → 토큰 렌더
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SpeechAnalysis } from '@/components/consult/SpeechAnalysis';
type SpeechAnalysisEvent = import('@/types/realtime').SpeechAnalysis;

// ── Mock AppSync subscriptions ───────────────────────────────────────────────
let emitSpeech: ((a: SpeechAnalysisEvent) => void) | null = null;
let emitStrategy: ((s: import('@/types/realtime').StrategyUpdate) => void) | null = null;
const unsubSpeech = vi.fn();
const unsubStrategy = vi.fn();

vi.mock('@/lib/appsync', () => ({
  subscribeSpeechAnalysis: (
    _callId: string,
    onData: (a: SpeechAnalysisEvent) => void,
  ) => {
    emitSpeech = onData;
    return unsubSpeech;
  },
  subscribeStrategyUpdate: (
    _callId: string,
    onData: (s: import('@/types/realtime').StrategyUpdate) => void,
  ) => {
    emitStrategy = onData;
    return unsubStrategy;
  },
}));

afterEach(() => {
  emitSpeech = null;
  emitStrategy = null;
  unsubSpeech.mockReset();
  unsubStrategy.mockReset();
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeAnalysis(
  tokens: Array<{ text: string; polarity: 'PRO' | 'CONS' | 'NEUTRAL'; reason?: string }>,
  turnSeq = 1,
): SpeechAnalysisEvent {
  return {
    callId: 'c1',
    turnSeq,
    tokens: tokens.map((t) => ({ ...t, reason: t.reason ?? '' })),
  };
}

describe('SpeechAnalysis — #33 키워드 폰트 강조 + flag 배지', () => {
  it('renders the panel without crashing (no turns)', () => {
    render(<SpeechAnalysis callId="c1" disableLiveData />);
    expect(screen.getByTestId('speech-analysis')).toBeInTheDocument();
  });

  it('applies .kw font-emphasis to PRO/CONS tokens via data-testid sa-kw', () => {
    render(
      <SpeechAnalysis
        callId="c1"
        disableLiveData
        initialState={{
          turns: [
            {
              turnSeq: 1,
              tokens: [
                { text: '금리', polarity: 'PRO', reason: '' },
                { text: '낮아질', polarity: 'CONS', reason: '' },
                { text: '수도', polarity: 'NEUTRAL', reason: '' },
              ],
            },
          ],
          selectedStrategyIndex: null,
          strategyLead: undefined,
        }}
      />,
    );

    const kwSpans = screen.getAllByTestId('sa-kw');
    expect(kwSpans).toHaveLength(2); // PRO + CONS are keywords, NEUTRAL is not

    // .kw has font emphasis class — NOT color class k-go/k-risk
    for (const kw of kwSpans) {
      expect(kw).toHaveClass('font-extrabold');
      expect(kw).not.toHaveClass('k-go');
      expect(kw).not.toHaveClass('k-risk');
    }
  });

  it('NEUTRAL tokens do NOT get kw emphasis', () => {
    render(
      <SpeechAnalysis
        callId="c1"
        disableLiveData
        initialState={{
          turns: [
            {
              turnSeq: 1,
              tokens: [{ text: '그냥', polarity: 'NEUTRAL', reason: '' }],
            },
          ],
          selectedStrategyIndex: null,
          strategyLead: undefined,
        }}
      />,
    );
    expect(screen.queryByTestId('sa-kw')).not.toBeInTheDocument();
  });

  it('CONS token in turn → .flag--risk badge shown', () => {
    render(
      <SpeechAnalysis
        callId="c1"
        disableLiveData
        initialState={{
          turns: [
            {
              turnSeq: 1,
              tokens: [{ text: '거절', polarity: 'CONS', reason: '' }],
            },
          ],
          selectedStrategyIndex: null,
          strategyLead: undefined,
        }}
      />,
    );
    expect(screen.getByTestId('sa-flag-risk')).toBeInTheDocument();
    expect(screen.queryByTestId('sa-flag-def')).not.toBeInTheDocument();
  });

  it('PRO token in turn → .flag--def badge shown', () => {
    render(
      <SpeechAnalysis
        callId="c1"
        disableLiveData
        initialState={{
          turns: [
            {
              turnSeq: 1,
              tokens: [{ text: '동의', polarity: 'PRO', reason: '' }],
            },
          ],
          selectedStrategyIndex: null,
          strategyLead: undefined,
        }}
      />,
    );
    expect(screen.getByTestId('sa-flag-def')).toBeInTheDocument();
    expect(screen.queryByTestId('sa-flag-risk')).not.toBeInTheDocument();
  });

  it('CONS+PRO in same turn → only .flag--risk shown (risk priority)', () => {
    render(
      <SpeechAnalysis
        callId="c1"
        disableLiveData
        initialState={{
          turns: [
            {
              turnSeq: 1,
              tokens: [
                { text: '좋아요', polarity: 'PRO', reason: '' },
                { text: '싫어요', polarity: 'CONS', reason: '' },
              ],
            },
          ],
          selectedStrategyIndex: null,
          strategyLead: undefined,
        }}
      />,
    );
    expect(screen.getByTestId('sa-flag-risk')).toBeInTheDocument();
    expect(screen.queryByTestId('sa-flag-def')).not.toBeInTheDocument();
  });

  it('NEUTRAL-only turn → no flag badge', () => {
    render(
      <SpeechAnalysis
        callId="c1"
        disableLiveData
        initialState={{
          turns: [
            {
              turnSeq: 1,
              tokens: [{ text: '네', polarity: 'NEUTRAL', reason: '' }],
            },
          ],
          selectedStrategyIndex: null,
          strategyLead: undefined,
        }}
      />,
    );
    expect(screen.queryByTestId('sa-flag-risk')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sa-flag-def')).not.toBeInTheDocument();
  });

  it('onSpeechAnalysis mock event → tokens rendered', async () => {
    render(<SpeechAnalysis callId="c1" />);
    expect(emitSpeech).toBeTypeOf('function');

    act(() => {
      emitSpeech!(makeAnalysis([{ text: '금리인하', polarity: 'PRO' }]));
    });

    expect(screen.getByTestId('sa-flag-def')).toBeInTheDocument();
    expect(screen.getByTestId('sa-kw')).toHaveTextContent('금리인하');
  });

  it('unsubscribes both subscriptions on unmount', () => {
    const { unmount } = render(<SpeechAnalysis callId="c1" />);
    unsubSpeech.mockClear();
    unsubStrategy.mockClear();
    unmount();
    expect(unsubSpeech).toHaveBeenCalledTimes(1);
    expect(unsubStrategy).toHaveBeenCalledTimes(1);
  });
});
