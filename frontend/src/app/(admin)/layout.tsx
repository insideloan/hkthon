import { Sidebar } from '@/app/_components/Sidebar';

// 관리자 화면 셸 — Sidebar + content. 기존 루트 레이아웃의 .wrap/.content 구조를
// 그대로 가진다(관리자 대시보드/AI 상담/CRM/세그먼트가 이 그룹). 모바일 체험(/m)은
// 이 레이아웃을 거치지 않아 사이드바가 붙지 않는다.
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // SSOT .wrap: display:flex; gap:11px; align-items:stretch (no min-height —
    // sidebar stretches to content height; body bg is fixed so no short-bg gap)
    <div className="flex gap-3 p-[18px_10px] items-stretch">
      <Sidebar />
      {/* SSOT .content: flex:1; min-width:0 */}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
