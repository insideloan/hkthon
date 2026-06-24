// DialOverlay — 통화 연결 오버레이.
// 발신하기 클릭 후 표시되는 풀스크린 연결 연출:
//   카운트다운(3·2·1) → 📞 발신 중… → 연결됨 ✓ → onConnected() 호출(상담 화면 전환).
// SSOT: docs/consult_redesigned-3.html #dialOverlay (CSS는 globals.css .dial-overlay).
'use client';

import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';

type DialPhase = 'count3' | 'count2' | 'count1' | 'dialing' | 'connected';

type DialOverlayProps = {
  /** 발신 대상 표시 이름(예: '박서준 고객'). */
  customerName: string;
  /** 마스킹된 전화번호 등 보조 표기. */
  phone?: string;
  /** 연결 완료 후 호출 — 상담 화면으로 전환한다. */
  onConnected: () => void;
};

// SSOT 타임라인(ms): 카운트다운 → 발신 중 → 연결됨 → 전환.
const T_COUNT2 = 800;
const T_COUNT1 = 1600;
const T_DIALING = 2400;
const T_CONNECTED = 3900;
const T_TRANSITION = 5100;

const STATUS_TEXT: Record<DialPhase, string> = {
  count3: '발신 준비',
  count2: '발신 준비',
  count1: '발신 준비',
  dialing: '발신 중…',
  connected: '통화 연결됨 · 상담 시작',
};

export function DialOverlay({ customerName, phone, onConnected }: DialOverlayProps) {
  const [phase, setPhase] = useState<DialPhase>('count3');
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const timers: number[] = [];
    const at = (ms: number, fn: () => void) =>
      timers.push(window.setTimeout(fn, reduce ? Math.min(ms, 300) : ms));

    at(T_COUNT2, () => setPhase('count2'));
    at(T_COUNT1, () => setPhase('count1'));
    at(T_DIALING, () => setPhase('dialing'));
    at(T_CONNECTED, () => setPhase('connected'));
    at(T_TRANSITION, () => onConnectedRef.current());

    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  const avatarInitial = customerName.trim().charAt(0) || '?';
  const countText =
    phase === 'count3' ? '3' : phase === 'count2' ? '2' : phase === 'count1' ? '1' : null;
  const dialing = phase === 'dialing';
  const connected = phase === 'connected';

  return (
    <div className="dial-overlay" data-testid="dial-overlay" data-phase={phase} role="status" aria-live="polite">
      <div className="dial-box">
        <div className="dial-ava" aria-hidden>{avatarInitial}</div>
        <div className="dial-name">{customerName}</div>
        {phone && <div className="dial-phone">{phone}</div>}
        <div
          className={clsx('dial-count', connected && 'ok', countText != null && 'pop')}
          key={phase}
          data-testid="dial-count"
        >
          {connected ? '연결됨 ✓' : dialing ? '📞' : countText}
        </div>
        <div className={clsx('dial-status', connected && 'go')} data-testid="dial-status">
          {STATUS_TEXT[phase]}
        </div>
        <div className={clsx('dial-waves', dialing && 'on')} aria-hidden>
          <i /><i /><i /><i /><i />
        </div>
      </div>
    </div>
  );
}
