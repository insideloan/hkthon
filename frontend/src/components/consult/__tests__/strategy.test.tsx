// RTL tests for SpeechAnalysis — FRONTEND-006 (#35) Acceptance.
// · 선택 전략 카드 headline이 큰 텍스트(.stx)로 렌더
// · lead/rationale가 .slead로 렌더
// · 별도 StrategyPanel·DB분석 개편 DOM 미존재 검증 (SSOT 정합)
// · onStrategyUpdate mock → 선택 전략 갱신 테스트
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SpeechAnalysis } from '@/components/consult/SpeechAnalysis';

type SpeechAnalysisEvent = import('@/types/realtime').SpeechAnalysis;
type StrategyUpdateEvent = import('@/types/realtime').StrategyUpdate;

// ── Mock AppSync subscriptions ───────────────────────────────────────────────
let emitSpeech: ((a: SpeechAnalysisEvent) => void) | null = null;
let emitStrategy: ((s: StrategyUpdateEvent) => void) | null = null;
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
    onData: (s: StrategyUpdateEvent) => void,
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

describe('SpeechAnalysis — #35 전략 파이프라인 (STRAT20 카드①)', () => {
  it('선택된 전략 카드 headline이 .stx(큰 텍스트)로 렌더', () => {
    render(
      <SpeechAnalysis
        callId="c1"
        disableLiveData
        initialState={{
          turns: [],
          selectedStrategyIndex: 9, // '대환 제안 전략'
          strategyLead: undefined,
        }}
      />,
    );

    const stx = screen.getByTestId('sa-stx');
    expect(stx).toHaveTextContent('대환 제안 전략');
    // Big text class applied when selected
    expect(stx).toHaveClass('text-[12.5px]');
  });

  it('lead/rationale가 .slead로 렌더', () => {
    render(
      <SpeechAnalysis
        callId="c1"
        disableLiveData
        initialState={{
          turns: [],
          selectedStrategyIndex: 9,
          strategyLead: '갈아타기 가능성과 절감 효과를 확인시킨다',
        }}
      />,
    );

    const slead = screen.getByTestId('sa-slead');
    expect(slead).toHaveTextContent('갈아타기 가능성과 절감 효과를 확인시킨다');
  });

  it('stratg에 resolved 클래스 표시 (선택 전략이 있을 때)', () => {
    render(
      <SpeechAnalysis
        callId="c1"
        disableLiveData
        initialState={{
          turns: [],
          selectedStrategyIndex: 5,
          strategyLead: undefined,
        }}
      />,
    );

    const stratg = screen.getByTestId('sa-stratg');
    expect(stratg).toHaveClass('resolved');
    expect(stratg).toHaveAttribute('data-resolved', 'true');
  });

  it('선택 전략이 없을 때 stratg에 resolved 클래스 없음', () => {
    render(
      <SpeechAnalysis
        callId="c1"
        disableLiveData
        initialState={{
          turns: [],
          selectedStrategyIndex: null,
          strategyLead: undefined,
        }}
      />,
    );

    const stratg = screen.getByTestId('sa-stratg');
    expect(stratg).not.toHaveClass('resolved');
    expect(stratg).toHaveAttribute('data-resolved', 'false');
  });

  it('onStrategyUpdate mock → 선택 전략 카드 갱신', async () => {
    render(<SpeechAnalysis callId="c1" />);
    expect(emitStrategy).toBeTypeOf('function');

    act(() => {
      emitStrategy!({
        callId: 'c1',
        turnSeq: 1,
        headline: '불안 완화 전략',
        rationale: '신용·개인정보 불안에 안전 기준 설명',
      });
    });

    const stx = screen.getByTestId('sa-stx');
    expect(stx).toHaveTextContent('불안 완화 전략');

    const slead = screen.getByTestId('sa-slead');
    expect(slead).toHaveTextContent('신용·개인정보 불안에 안전 기준 설명');
  });

  it('별도 StrategyPanel DOM 없음 (SSOT 정합: 전략은 카드①에 통합)', () => {
    render(
      <SpeechAnalysis
        callId="c1"
        disableLiveData
        initialState={{ turns: [], selectedStrategyIndex: null, strategyLead: undefined }}
      />,
    );

    // No separate strategy panel with the old headline/rationale/data 3-split layout
    expect(document.querySelector('[data-testid="strategy-panel"]')).not.toBeInTheDocument();
    expect(document.querySelector('.strategy-panel')).not.toBeInTheDocument();
  });

  it('onStrategyUpdate headline이 STRAT20에 없으면 선택 전략 null로 처리', async () => {
    render(<SpeechAnalysis callId="c1" />);

    act(() => {
      emitStrategy!({
        callId: 'c1',
        turnSeq: 1,
        headline: '존재하지않는전략',
        rationale: '알 수 없음',
      });
    });

    const stratg = screen.getByTestId('sa-stratg');
    expect(stratg).not.toHaveClass('resolved');
    expect(screen.queryByTestId('sa-stx')).not.toBeInTheDocument();
  });

  it('20개 전략 카드가 모두 렌더 (미선택 시)', () => {
    render(
      <SpeechAnalysis
        callId="c1"
        disableLiveData
        initialState={{ turns: [], selectedStrategyIndex: null, strategyLead: undefined }}
      />,
    );

    // All 20 strategy cards rendered (none selected = no hidden cards)
    const cards = screen.getAllByTestId('sa-scard');
    expect(cards).toHaveLength(20);
  });
});
