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
        'queue-active': '#f59e0b', // in-call / 진행중 (노랑)
        'queue-noanswer': '#1f2937', // ringing / dialing (검정)
        'queue-rejected': '#b45309', // rejected (갈색)
        'queue-signup': '#16a34a', // 가입승인 (초록)
        'queue-escalate': '#ef4444', // needs_agent / transfer (빨강)
        // churn-risk gauge stops
        'risk-low': '#16a34a',
        'risk-mid': '#f59e0b',
        'risk-high': '#ef4444',
        // reference design system tokens — premium SaaS light-neutral palette.
        // Values mirror globals.css :root (keep in sync). Neutral blue used sparingly.
        route: '#2563eb', // primary action / neutral blue accent
        'route-2': '#4d7cf0',
        hazard: '#d97706', // warning amber / 우려 구간
        'hazard-ink': '#b45309',
        danger: '#ef4444', // 위반 · 이탈 (negative)
        go: '#16a34a', // 통과 · 전환 (positive)
        ink: '#111827', // primary text
        'ink-dim': '#6b7280', // secondary text
        'ink-faint': '#9ca3af', // muted text
        // compliance panel (작성→재작성)
        'cmp-draft': '#fef2f2', // 가안 배경 (위반 표현 포함)
        'cmp-final': '#f0fdf4', // 최종 발화 배경 (통과)
      },
      // Typography — Inter primary, system-ui fallback (reference design system).
      fontFamily: {
        sans: ['Inter', 'Pretendard', 'system-ui', '-apple-system', 'sans-serif'],
        disp: ['Inter', 'system-ui', '-apple-system', 'Pretendard', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      // Large rounded-corner system (reference radius scale).
      borderRadius: {
        sm: '10px',
        md: '14px',
        lg: '18px',
        xl: '24px',
      },
      // Subtle elevation only (reference effects).
      boxShadow: {
        card: '0 8px 32px rgba(0,0,0,0.04)',
        soft: '0 4px 20px rgba(0,0,0,0.05)',
      },
    },
  },
  plugins: [],
};

export default config;
