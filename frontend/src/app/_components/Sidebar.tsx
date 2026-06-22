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
    href: '/calls/demo',
    icon: <ConsultIcon />,
    labelLine1: 'AI 상담',
    labelLine2: '화면',
    matchPrefix: '/calls',
  },
  {
    href: '/crm/demo',
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
        {/* Brand text: font-disp; 10.5px; font-weight:800 */}
        <span
          className="font-disp font-black text-ink leading-tight"
          style={{ fontSize: '10.5px' }}
        >
          ㅎㅋ톡
        </span>
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
