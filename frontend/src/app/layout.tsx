import './globals.css';

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
      <body>{children}</body>
    </html>
  );
}
