// RTL tests for ConsultFlow (FRONTEND-010 / #39 Acceptance).
// Acceptance criteria:
//   (1) MOT가 매핑된 sum-flow 단계에 마커 렌더 테스트 통과
//   (2) MOT 없는 단계/빈 응답 시 마커 미존재
//   (3) 별도 MotBoard/타임라인/디테일 카드 DOM 미존재 검증
//   (4) mots mock 응답 → 단계 마커 렌더 테스트
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ConsultFlow } from '@/components/crm/ConsultFlow';
import type { MotDetected } from '@/types/realtime';

// Mock appsync so fetchMots is controllable without network
vi.mock('@/lib/appsync', () => ({
  fetchMots: vi.fn().mockResolvedValue([]),
}));

// ── helpers ──────────────────────────────────────────────────────────────────
function makeMot(overrides: Partial<MotDetected> & { callId?: string } = {}): MotDetected {
  return {
    callId: 'c1',
    seq: 1,
    type: 'RISK',
    turnSeq: 3,
    churnBefore: 30,
    churnAfter: 55,
    triggers: [],
    strategy: null,
    outcome: null,
    narrative: null,
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────
describe('ConsultFlow', () => {
  // (2) empty state: no markers, all 4 steps present
  it('renders all 4 sum-flow steps with no markers when MOT list is empty', () => {
    render(
      <ConsultFlow callId="c1" initialMots={[]} disableLiveData />,
    );

    const flow = screen.getByTestId('consult-flow');
    expect(flow).toBeInTheDocument();

    // All 4 SSOT stages rendered
    expect(within(flow).getByTestId('flow-step-신뢰 쌓기')).toBeInTheDocument();
    expect(within(flow).getByTestId('flow-step-우려 풀기')).toBeInTheDocument();
    expect(within(flow).getByTestId('flow-step-담보 오해')).toBeInTheDocument();
    expect(within(flow).getByTestId('flow-step-전환 맺기')).toBeInTheDocument();

    // No markers at all
    expect(screen.queryByTestId('mot-marker')).not.toBeInTheDocument();
  });

  // (2) step without MOT has no marker; step WITH MOT has marker
  it('renders a marker only on the step that has a mapped MOT', () => {
    const mot = makeMot({
      narrative: '신뢰 쌓기 단계 — 불신 우회',
      triggers: ['신뢰'],
      outcome: 'defended',
    });

    render(
      <ConsultFlow callId="c1" initialMots={[mot]} disableLiveData />,
    );

    const trustStep = screen.getByTestId('flow-step-신뢰 쌓기');
    const concernStep = screen.getByTestId('flow-step-우려 풀기');
    const securityStep = screen.getByTestId('flow-step-담보 오해');
    const conversionStep = screen.getByTestId('flow-step-전환 맺기');

    // Only trust step has a marker
    expect(within(trustStep).getByTestId('mot-marker')).toBeInTheDocument();
    expect(within(concernStep).queryByTestId('mot-marker')).not.toBeInTheDocument();
    expect(within(securityStep).queryByTestId('mot-marker')).not.toBeInTheDocument();
    expect(within(conversionStep).queryByTestId('mot-marker')).not.toBeInTheDocument();
  });

  // (1) MOT가 매핑된 단계 → 마커 렌더 + 올바른 스타일
  it('renders a defended (go/green) marker for outcome=defended', () => {
    const mot = makeMot({
      type: 'RISK',
      outcome: 'defended',
      narrative: '담보 오해 — 차량 사용 우려',
      triggers: ['담보'],
    });

    render(<ConsultFlow callId="c1" initialMots={[mot]} disableLiveData />);

    const marker = within(
      screen.getByTestId('flow-step-담보 오해'),
    ).getByTestId('mot-marker');

    expect(marker).toHaveAttribute('data-mot-outcome', 'defended');
    // Tailwind class for go variant
    expect(marker).toHaveClass('text-go');
    expect(marker).toHaveTextContent('방어');
  });

  it('renders a hazard (orange) marker for RISK without defended outcome', () => {
    const mot = makeMot({
      type: 'RISK',
      outcome: 'lost',
      narrative: '우려 풀기 — 가격 저항 심화',
      triggers: ['우려'],
    });

    render(<ConsultFlow callId="c1" initialMots={[mot]} disableLiveData />);

    const marker = within(
      screen.getByTestId('flow-step-우려 풀기'),
    ).getByTestId('mot-marker');

    expect(marker).toHaveAttribute('data-mot-type', 'RISK');
    expect(marker).toHaveClass('text-hazard-ink');
    expect(marker).toHaveTextContent('위험');
  });

  it('renders a defended marker for CONVERSION type', () => {
    const mot = makeMot({
      type: 'CONVERSION',
      outcome: 'converted',
      narrative: '전환 맺기 — 연결 성공',
      triggers: ['전환'],
    });

    render(<ConsultFlow callId="c1" initialMots={[mot]} disableLiveData />);

    const marker = within(
      screen.getByTestId('flow-step-전환 맺기'),
    ).getByTestId('mot-marker');

    expect(marker).toHaveAttribute('data-mot-type', 'CONVERSION');
    expect(marker).toHaveClass('text-go');
  });

  // (4) mots mock → 단계별 마커 렌더
  it('renders markers on all 4 steps when mots mock provides one per stage', () => {
    const mots: MotDetected[] = [
      makeMot({ seq: 1, narrative: '신뢰 쌓기', triggers: ['신뢰'], outcome: 'defended' }),
      makeMot({ seq: 2, narrative: '우려 풀기', triggers: ['우려'], outcome: 'defended' }),
      makeMot({ seq: 3, narrative: '담보 오해', triggers: ['담보'], outcome: 'lost' }),
      makeMot({ seq: 4, type: 'CONVERSION', narrative: '전환 맺기', triggers: ['전환'], outcome: 'converted' }),
    ];

    render(<ConsultFlow callId="c1" initialMots={mots} disableLiveData />);

    const flow = screen.getByTestId('consult-flow');
    const allMarkers = within(flow).getAllByTestId('mot-marker');
    // One per stage = 4 markers
    expect(allMarkers).toHaveLength(4);
  });

  // (3) DOM에 별도 MotBoard / 타임라인 / 디테일 카드 미존재
  it('does NOT render any separate MotBoard, timeline, or detail card DOM', () => {
    const mots: MotDetected[] = [
      makeMot({ seq: 1, narrative: '신뢰 쌓기', triggers: ['신뢰'], outcome: 'defended' }),
    ];

    render(<ConsultFlow callId="c1" initialMots={mots} disableLiveData />);

    // No MotBoard test id
    expect(screen.queryByTestId('mot-board')).not.toBeInTheDocument();
    // No timeline
    expect(screen.queryByTestId('mot-timeline')).not.toBeInTheDocument();
    // No detail card
    expect(screen.queryByTestId('mot-detail')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mot-card')).not.toBeInTheDocument();

    // Only the consult-flow ol exists at root
    expect(screen.getByTestId('consult-flow').tagName).toBe('OL');
  });

  // (2) 빈 MOT 응답 시 마커 미존재 (explicit empty array)
  it('shows no markers when initialMots is empty', () => {
    render(<ConsultFlow callId="c1" initialMots={[]} disableLiveData />);
    expect(screen.queryByTestId('mot-marker')).not.toBeInTheDocument();
  });
});
