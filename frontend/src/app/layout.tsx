import './globals.css';

export const metadata = {
  title: 'AI 상담 코파일럿',
  description: '관리자 콜 큐 대시보드',
};

// 루트 레이아웃 — html/body 골격만. 사이드바 등 화면 셸은 라우트 그룹별 레이아웃이
// 책임진다. 관리자 화면((admin) 그룹)은 Sidebar를 두고, 모바일 체험(/m)은 사이드바
// 없는 풀스크린이므로 이 최소 골격만 상속한다.
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
      <body>{children}</body>
    </html>
  );
}
