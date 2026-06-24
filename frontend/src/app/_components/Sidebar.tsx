'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// SVG icons extracted directly from SSOT docs/consult_redesigned-3.html lines 908-918
const AdminIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" width={19} height={19}>
    <rect x="3.5" y="4" width="17" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
    <path d="M3.5 9h17M8 4v16" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

const ConsultIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" width={19} height={19}>
    <path
      d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9A1.5 1.5 0 0 1 18.5 16H9l-4 3.5V16H5.5A1.5 1.5 0 0 1 4 14.5v-9z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

const CrmIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" width={19} height={19}>
    <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" />
    <path
      d="M3.5 19c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <path
      d="M16.5 4.5a3 3 0 0 1 0 6M18.5 19c0-2.4-.9-4.3-2.6-5.3"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

interface NavItem {
  href: string;
  icon: React.ReactNode;
  labelLine1: string;
  labelLine2: string;
  /** pathname prefix that marks this item active */
  matchPrefix: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/',
    icon: <AdminIcon />,
    labelLine1: '관리자',
    labelLine2: '화면',
    matchPrefix: '/',
  },
  {
    // 데모는 관리자 큐 → 세그먼트 → 상담으로 내부 이동하므로 이 메뉴는 쓰지 않는다.
    // 메뉴로 직접 진입하면 발신중(DIALING) 큐를 먼저 띄워 행을 고르게 한다.
    href: '/calls',
    icon: <ConsultIcon />,
    labelLine1: 'AI 상담',
    labelLine2: '화면',
    matchPrefix: '/calls',
  },
  {
    // 메뉴로 직접 진입하면 종료(ENDED) 큐를 먼저 띄워 행을 고르게 한다.
    href: '/crm',
    icon: <CrmIcon />,
    labelLine1: '상담',
    labelLine2: 'CRM',
    matchPrefix: '/crm',
  },
];

function isActive(itemPrefix: string, pathname: string): boolean {
  if (itemPrefix === '/') {
    // Root: active only when not under /calls or /crm
    return !pathname.startsWith('/calls') && !pathname.startsWith('/crm');
  }
  return pathname.startsWith(itemPrefix);
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    // SSOT .sidebar: flex:none; width:80px; frosted glass; border-radius:18px; padding:12px 8px
    <aside
      className="glass-card flex flex-col gap-[6px] shrink-0 w-20 self-stretch p-3"
      style={{ padding: '12px 8px' }}
    >
      {/* SSOT .sb-brand: flex-col; align-center; border-bottom: 1px solid var(--hair); mb:8px */}
      <div
        className="flex flex-col items-center gap-[5px] text-center pb-[11px] mb-2"
        style={{ borderBottom: '1px solid var(--hair)' }}
      >
        {/* SSOT .sb-logo-img: Hyundai Capital logo base64 PNG, max-width:78px */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="sb-logo-img"
          src="data:image/png;base64,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"
          alt="현대캐피탈"
          style={{ width: '100%', maxWidth: '78px', height: 'auto', objectFit: 'contain', display: 'block' }}
        />
        {/* Brand text: font-disp; 10.5px; font-weight:800 */}
        <span
          className="font-disp font-black text-ink leading-tight"
          style={{ fontSize: '10.5px' }}
        >
          ㅎㅋ톡
        </span>
        {/* SSOT .sb-brand-tx i: font-mono 7.5px ink-faint subtitle */}
        <i
          className="font-mono not-italic"
          style={{ fontSize: '7.5px', color: 'var(--ink-faint)', fontStyle: 'normal' }}
        >
          AI 콜센터
        </i>
      </div>

      {/* SSOT .sb-nav: flex-col; gap:5px; flex:1 */}
      <nav className="flex flex-col gap-[5px] flex-1">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.matchPrefix, pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              /* SSOT .sb-item: flex-col; align-center; font-kr; 10.5px; font-weight:700;
                 border-radius:11px; padding:9px 4px; transition:all .2s
                 .sb-item.active: bg:var(--route); border-color:var(--route); color:#fff;
                                   box-shadow:0 6px 16px -8px rgba(53,81,214,.6) */
              className={[
                'flex flex-col items-center gap-1 w-full text-center cursor-pointer',
                'font-kr text-[10.5px] font-bold leading-[1.15]',
                'rounded-[11px] transition-all duration-200 no-underline',
                'border',
                active
                  ? 'bg-route border-route text-white'
                  : 'bg-transparent border-transparent text-ink-dim hover:bg-white/50 hover:text-ink',
              ].join(' ')}
              style={
                active
                  ? {
                      padding: '9px 4px',
                      boxShadow: '0 6px 16px -8px rgba(53,81,214,.6)',
                    }
                  : { padding: '9px 4px' }
              }
              aria-current={active ? 'page' : undefined}
            >
              {item.icon}
              {/* SSOT .sb-label: display:block; line-height:1.25; word-break:keep-all */}
              <span
                className="block"
                style={{ lineHeight: '1.25', wordBreak: 'keep-all' }}
              >
                {item.labelLine1}
                <br />
                {item.labelLine2}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* SSOT .sb-foot: mt:auto; flex-col; align-center; font-mono; 7.5px; font-weight:700;
          color:var(--ink-faint); border-top:1px solid var(--hair);
          .d: 7px circle; background:var(--go); animation:beatG 1.6s ease-out infinite */}
      <div
        className="mt-auto flex flex-col items-center gap-1 font-mono font-bold text-ink-faint text-center pt-[9px] pb-[2px]"
        style={{
          fontSize: '7.5px',
          borderTop: '1px solid var(--hair)',
        }}
      >
        <span
          className="block rounded-full bg-go"
          style={{
            width: '7px',
            height: '7px',
            animation: 'beatG 1.6s ease-out infinite',
          }}
        />
        LIVE
      </div>
    </aside>
  );
}
