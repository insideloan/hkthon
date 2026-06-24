// RTL tests for SpeechAnalysis — FRONTEND-005 (#34) Acceptance.
// · reason 텍스트가 선택 전략 카드의 lead 영역(.sa-slead)에 렌더
// · .kw-reason 아코디언 DOM 미존재 검증 (SSOT 정합)
// · onSpeechAnalysis mock → reason 반영 테스트
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

describe('SpeechAnalysis — #34 reason은 선택 전략 카드 lead, .kw-reason 아코디언 없음', () => {
  it('선택된 전략 카드(.scard.sel)에 overrideLead(reason) 텍스트 노출', () => {
    render(
      <SpeechAnalysis
        callId="c1"
        disableLiveData
        initialState={{
          turns: [],
          selectedStrategyIndex: 4, // '공감 후 전환 전략'
          strategyLead: '우려를 먼저 인정한다는 reason 텍스트',
        }}
      />,
    );

    const slead = screen.getByTestId('sa-slead');
    expect(slead).toHaveTextContent('우려를 먼저 인정한다는 reason 텍스트');
  });

  it('선택된 전략 카드(.stx)가 큰 텍스트로 전략명을 렌더', () => {
    render(
      <SpeechAnalysis
        callId="c1"
        disableLiveData
        initialState={{
          turns: [],
          selectedStrategyIndex: 4,
          strategyLead: undefined,
        }}
      />,
    );

    const stx = screen.getByTestId('sa-stx');
    expect(stx).toHaveTextContent('공감 후 전환 전략');
  });

  it('.kw-reason 아코디언 DOM이 존재하지 않음 (SSOT 정합)', () => {
    render(
      <SpeechAnalysis
        callId="c1"
        disableLiveData
        initialState={{
          turns: [
            {
              turnSeq: 1,
              tokens: [
                { text: '금리', polarity: 'CONS', reason: '금리 관련 우려' },
              ],
            },
          ],
          selectedStrategyIndex: 4,
          strategyLead: '금리 관련 우려',
        }}
      />,
    );

    // SSOT에 .kw-reason 아코디언 없음
    expect(document.querySelector('.kw-reason')).not.toBeInTheDocument();
    // aria-expanded 토글 버튼도 없음
    expect(document.querySelector('[aria-expanded]')).not.toBeInTheDocument();
  });

  it('onSpeechAnalysis mock → last token reason이 selected strategy lead에 반영', async () => {
    render(
      <SpeechAnalysis
        callId="c1"
        initialState={{
          turns: [],
          selectedStrategyIndex: 2, // '상품 확인 전략'
          strategyLead: '기존 lead',
        }}
      />,
    );

    // Emit strategy first so a card is selected
    act(() => {
      emitStrategy!({
        callId: 'c1',
        turnSeq: 1,
        strategyHeadline: '상품 확인 전략',
        rationale: '상품 구조를 먼저 설명',
      });
    });

    expect(screen.getByTestId('sa-slead')).toHaveTextContent('상품 구조를 먼저 설명');

    // Now emit speech with a reason
    act(() => {
      emitSpeech!({
        callId: 'c1',
        turnSeq: 2,
        tokens: [{ text: '구조', polarity: 'PRO', reason: '상품 구조 관련 reason' }],
      });
    });

    expect(screen.getByTestId('sa-slead')).toHaveTextContent('상품 구조 관련 reason');
  });

  it('reason이 없는 경우 STRAT20 기본 lead를 유지', () => {
    render(
      <SpeechAnalysis
        callId="c1"
        disableLiveData
        initialState={{
          turns: [],
          selectedStrategyIndex: 0, // '관심 환기 전략'
          strategyLead: undefined,
        }}
      />,
    );

    const slead = screen.getByTestId('sa-slead');
    expect(slead).toHaveTextContent('개인 관련성 높은 한 문장으로 통화 지속 이유를 만든다');
  });
});
