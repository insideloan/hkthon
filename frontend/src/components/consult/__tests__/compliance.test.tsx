// RTL tests for CompliancePanel (FRONTEND-008 / #37 Acceptance).
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import { CompliancePanel } from '@/components/consult/CompliancePanel';
import type { ComplianceState } from '@/types/compliance';

// Mock the AppSync layer so we can drive onComplianceState by hand.
let emitState: ((s: ComplianceState) => void) | null = null;
const unsubscribe = vi.fn();
vi.mock('@/lib/appsync', () => ({
  subscribeComplianceState: (
    _callId: string,
    onData: (s: ComplianceState) => void,
  ) => {
    emitState = onData;
    return unsubscribe;
  },
}));

const CHECKS = [
  { law: '금소법', desc: '확정·과장 표현 점검' },
  { law: '개인정보법', desc: '불필요 정보 요청 점검' },
  { law: '신용정보법', desc: '활용 범위 준수 점검' },
  { law: '표현리스크', desc: '오해·강요 문구 점검' },
];

function state(over: Partial<ComplianceState> = {}): ComplianceState {
  return {
    callId: 'c1',
    phase: 'drafting',
    draft: '무조건 더 싸게 갈아타게 해드릴 테니 지금 신청만 하시면 됩니다.',
    violations: ['무조건 더 싸게 갈아타게', '지금 신청만 하시면 됩니다.'],
    checks: [],
    violatedPolicies: [],
    final: [],
    ...over,
  };
}

afterEach(() => {
  unsubscribe.mockReset();
  emitState = null;
});

describe('CompliancePanel', () => {
  it('renders the draft with violation spans highlighted (drafting)', () => {
    render(<CompliancePanel callId="c1" disableLiveData initialState={state()} />);

    const panel = screen.getByTestId('compliance-panel');
    expect(panel).toHaveAttribute('data-phase', 'drafting');
    const violations = screen.getAllByTestId('cmp-violation');
    expect(violations).toHaveLength(2);
    expect(violations[0]).toHaveClass('text-danger');
    // drafting 단계엔 아직 취소선 없음.
    expect(violations[0]).not.toHaveClass('line-through');
    // 규제 검토/최종 발화는 아직 안 보임.
    expect(screen.queryByTestId('cmp-check')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cmp-final')).not.toBeInTheDocument();
  });

  it('renders the 4 regulatory checks with flag labels (reviewing)', () => {
    render(
      <CompliancePanel
        callId="c1"
        disableLiveData
        initialState={state({
          phase: 'reviewing',
          checks: [
            { ...CHECKS[0], flagged: true },
            { ...CHECKS[1], flagged: false },
            { ...CHECKS[2], flagged: false },
            { ...CHECKS[3], flagged: true },
          ],
        })}
      />,
    );

    const rows = screen.getAllByTestId('cmp-check');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveAttribute('data-flagged', 'true');
    expect(rows[1]).toHaveAttribute('data-flagged', 'false');
    expect(within(rows[0]).getByText('수정')).toBeInTheDocument();
    expect(within(rows[1]).getByText('이상無')).toBeInTheDocument();
  });

  it('strikes through violations and shows violated policies (redacting)', () => {
    render(
      <CompliancePanel
        callId="c1"
        disableLiveData
        initialState={state({
          phase: 'redacting',
          checks: CHECKS.map((c, i) => ({ ...c, flagged: i === 0 || i === 3 })),
          violatedPolicies: ['금소법', '표현리스크'],
        })}
      />,
    );

    const violations = screen.getAllByTestId('cmp-violation');
    expect(violations[0]).toHaveClass('line-through');
    const policies = screen.getByTestId('cmp-violated-policies');
    expect(within(policies).getByText('금소법 위반')).toBeInTheDocument();
    expect(within(policies).getByText('표현리스크 위반')).toBeInTheDocument();
  });

  it('shows the final diff and pass badge (approved)', () => {
    render(
      <CompliancePanel
        callId="c1"
        disableLiveData
        initialState={state({
          phase: 'approved',
          checks: CHECKS.map((c, i) => ({ ...c, flagged: i === 0 || i === 3 })),
          final: [
            { text: '요즘 대출 전화 피로감 크시죠. 오늘은 ' },
            { del: '무조건 더 싸게 갈아타게', ins: '신청이 아니라 유지가 나은지 비교만' },
            { text: ' 도와드리려는 거예요. ' },
            { ins: '다만 확정은 아니고 심사 후 결정됩니다.', added: true },
          ],
        })}
      />,
    );

    const final = screen.getByTestId('cmp-final');
    // 교체: 원문 취소선(del) + 수정문(ins).
    expect(within(final).getByText('무조건 더 싸게 갈아타게').tagName).toBe('DEL');
    expect(within(final).getByText('신청이 아니라 유지가 나은지 비교만').tagName).toBe('INS');
    // 신규 추가 세그먼트.
    expect(within(final).getByText('다만 확정은 아니고 심사 후 결정됩니다.').tagName).toBe('INS');
    // 통과 배지.
    expect(screen.getByTestId('cmp-pass')).toHaveTextContent('전 규제 통과');
  });

  it('transitions through phases on onComplianceState events', async () => {
    render(<CompliancePanel callId="c1" />);
    // 구독 콜백이 등록됨.
    expect(emitState).toBeTypeOf('function');

    act(() => emitState!(state({ phase: 'drafting' })));
    expect(screen.getByTestId('compliance-panel')).toHaveAttribute('data-phase', 'drafting');
    expect(screen.queryByTestId('cmp-pass')).not.toBeInTheDocument();

    act(() =>
      emitState!(
        state({
          phase: 'approved',
          checks: CHECKS.map((c, i) => ({ ...c, flagged: i === 0 })),
          final: [{ text: '비교만 도와드릴게요.' }],
        }),
      ),
    );
    expect(screen.getByTestId('compliance-panel')).toHaveAttribute('data-phase', 'approved');
    expect(screen.getByTestId('cmp-pass')).toBeInTheDocument();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<CompliancePanel callId="c1" />);
    unsubscribe.mockClear();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
