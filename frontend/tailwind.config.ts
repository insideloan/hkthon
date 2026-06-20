import type { Config } from 'tailwindcss';

// theme/colors SSOT (TEAM-LOCK). Template swaps only touch theme.extend here.
// Palette mirrors the reference design (data/archive/consult_redesigned-2.html
// :root vars). Semantic names carry meaning (CONVENTIONS.md §6.2) — keep stable.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Call-state badge palette (semantic — keep stable across template swaps).
        'queue-active': '#fbbf24', // in-call / 진행중 (노랑)
        'queue-noanswer': '#1f2937', // ringing / dialing (검정)
        'queue-rejected': '#92400e', // rejected (갈색)
        'queue-signup': '#10b981', // 가입승인 (초록)
        'queue-escalate': '#ef4444', // needs_agent / transfer (빨강)
        // churn-risk gauge stops
        'risk-low': '#10b981',
        'risk-mid': '#fbbf24',
        'risk-high': '#ef4444',
        // reference design system tokens (consult / compliance views)
        route: '#3551D6', // primary action / route ink
        'route-2': '#5B78F0',
        hazard: '#CF8A3C', // resistance / 우려 구간
        'hazard-ink': '#8A5A1E',
        danger: '#DB5350', // 위반 · 이탈
        go: '#2E9E6E', // 통과 · 전환
        ink: '#23293A',
        'ink-dim': '#5E6678',
        'ink-faint': '#9AA0AC',
        // compliance panel (작성→재작성)
        'cmp-draft': '#FFF7F6', // 가안 배경 (위반 표현 포함)
        'cmp-final': '#F5FBF8', // 최종 발화 배경 (통과)
      },
    },
  },
  plugins: [],
};

export default config;
