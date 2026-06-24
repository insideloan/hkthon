import './globals.css';
import { Sidebar } from '@/app/_components/Sidebar';

export const metadata = {
  title: 'AI 상담 코파일럿',
  description: '관리자 콜 큐 대시보드',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/tabler-icons/3.31.0/iconfont/tabler-icons.min.css" />
      </head>
      <body>
        {/* SSOT .wrap: display:flex; gap:11px; align-items:stretch (no min-height —
            sidebar stretches to content height; body bg is fixed so no short-bg gap) */}
        <div className="flex gap-3 p-[18px_10px] items-stretch">
          <Sidebar />
          {/* SSOT .content: flex:1; min-width:0 */}
          <div className="flex-1 min-w-0">{children}</div>
        </div>
      </body>
    </html>
  );
}
