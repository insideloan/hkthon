// 모바일 체험(/m) 레이아웃 — 사이드바 없는 풀스크린. QR로 진입해 폼 입력 →
// 라이브 상담으로 바로 이어지는 단독 플로우. 루트 레이아웃(html/body)만 상속한다.
import type { Viewport } from 'next';

// 모바일 풀스크린 — 확대 방지 + 노치/홈인디케이터 안전영역 대응.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#3551d6',
};

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col"
      style={{
        minHeight: '100dvh',
        // 안전영역(노치/홈바) 패딩.
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        // 배경은 body(globals.css)의 고정 그라데이션을 그대로 비춘다 — 별도 색을 칠하면
        // iOS 오버스크롤 시 body 배경과 톤이 어긋난다.
        background: 'transparent',
      }}
    >
      {children}
    </div>
  );
}
