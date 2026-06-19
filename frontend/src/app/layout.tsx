// PLACEHOLDER root layout — replaced by FRONTEND-001+ (주실).
export const metadata = {
  title: 'AI 상담 코파일럿',
  description: 'Amplify deploy placeholder',
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
