// CRM 상담 요약 페이지 레이아웃 테스트 (SSOT #view-summary).
// Verifies: heading, profile section, agents section.
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import CrmDetailPage from '@/app/crm/[id]/page';

// ── Mock AppSync so live subscriptions don't fire ──────────────────────────
vi.mock('@/lib/appsync', () => ({
  subscribeSpeechAnalysis: () => () => {},
  subscribeStrategyUpdate: () => () => {},
  subscribeComplianceState: () => () => {},
  subscribeMotDetected: () => () => {},
  subscribeIndexUpdate: () => () => {},
  fetchMots: () => Promise.resolve([]),
}));

// ── Mock Zustand motStore ──────────────────────────────────────────────────
vi.mock('@/stores/motStore', () => {
  const MOT_MARKER_IDS = ['rz-rate', 'rz-compare', 'rz-pay', 'rz-security', 'rz-avoid'];
  return {
    MOT_MARKER_IDS,
    useMotStore: () => ({
      markers: MOT_MARKER_IDS.map((id: string) => ({ id, state: 'hidden' })),
      activeCautionSeq: null,
      addMot: vi.fn(),
      setMarkerState: vi.fn(),
      showCaution: vi.fn(),
      hideCaution: vi.fn(),
      reset: vi.fn(),
    }),
  };
});

// Next.js 15: params는 Promise (페이지가 use(params)로 언래핑).
// use(params)가 첫 렌더에서 suspend → act로 감싸 microtask를 flush해야 resolve된다.
async function renderPage() {
  await act(async () => {
    render(<CrmDetailPage params={Promise.resolve({ id: 'demo' })} />);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('CrmDetailPage — #view-summary layout', () => {
  it('renders "상담 CRM" heading', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { name: '상담 CRM' })).toBeInTheDocument();
  });

  it('renders customer profile with 박서준', async () => {
    await renderPage();
    expect(screen.getByText('박서준 · 남 · 38세')).toBeInTheDocument();
  });

  it('renders profile card with 고객 프로필 heading', async () => {
    await renderPage();
    expect(screen.getByText('고객 프로필')).toBeInTheDocument();
  });

  it('renders agents section heading "대기 중 상담사"', async () => {
    await renderPage();
    expect(screen.getByText('대기 중 상담사')).toBeInTheDocument();
  });

  it('renders at least one agent name', async () => {
    await renderPage();
    // 목 에이전트 중 첫 번째 이름 확인
    expect(screen.getByText('김지수')).toBeInTheDocument();
  });

  it('renders ConsultFlow inside flow card', async () => {
    await renderPage();
    expect(screen.getByTestId('consult-flow')).toBeInTheDocument();
  });

  it('renders needs chips section with 권장 액션', async () => {
    await renderPage();
    expect(screen.getByText('금리 인하 요구권')).toBeInTheDocument();
    expect(screen.getByText(/우대금리.*적용 제안/)).toBeInTheDocument();
  });

  it('renders the sum-tag status label', async () => {
    await renderPage();
    expect(screen.getByText('AI 상담 종료 · 상담사 연결 대기')).toBeInTheDocument();
  });
});
