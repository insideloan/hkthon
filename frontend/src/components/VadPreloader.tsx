// VadPreloader — 랜딩 페이지에 마운트되면 브라우저 idle 시점에 VAD/DNF 에셋을 미리
// 받아둔다(preloadVadAssets). 렌더 출력은 없다. PC 랜딩(/)·모바일 랜딩(/m) 양쪽에
// 두어, 사용자가 "상담 시작"을 누르기 전 무거운 모델(~35MB)을 백그라운드로 끌어온다.
//
// requestIdleCallback으로 미뤄 랜딩의 첫 렌더/상호작용을 방해하지 않는다(미지원
// 브라우저는 짧은 setTimeout 폴백). 멱등성은 preloadVadAssets가 보장하므로 중복
// 마운트돼도 안전하다.
'use client';

import { useEffect } from 'react';
import { preloadVadAssets } from '@/lib/preloadVadAssets';

type WindowWithIdle = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
};

export function VadPreloader() {
  useEffect(() => {
    const w = window as WindowWithIdle;
    if (typeof w.requestIdleCallback === 'function') {
      w.requestIdleCallback(() => preloadVadAssets(), { timeout: 3000 });
    } else {
      // Safari 등 미지원 — 초기 렌더가 끝난 뒤로 살짝 미룬다.
      const id = window.setTimeout(() => preloadVadAssets(), 1500);
      return () => clearTimeout(id);
    }
  }, []);

  return null;
}
