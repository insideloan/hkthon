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
  /**
   * 고객이 실제로 수신했는지(=콜 state가 IN_CALL 로 전환). true 가 되면 타임라인을
   * 즉시 단축해 '연결됨 ✓' 로 점프하고 짧은 확인 후 onConnected() 를 호출한다.
   * 미제공/false 면 아래 고정 타임라인(T_TRANSITION)을 폴백으로 사용한다 — mock·데모
   * 모드처럼 실제 수신 신호가 없는 환경에서도 흐름이 멈추지 않도록.
   */
  answered?: boolean;
};

// SSOT 타임라인(ms): 카운트다운 → 발신 중 → 연결됨 → 전환.
const T_COUNT2 = 800;
const T_COUNT1 = 1600;
const T_DIALING = 2400;
const T_CONNECTED = 3900;
const T_TRANSITION = 5100;
// 실제 수신 신호로 점프했을 때 '연결됨 ✓' 를 보여주는 최소 확인 시간(ms).
const T_ANSWERED_CONFIRM = 700;

const STATUS_TEXT: Record<DialPhase, string> = {
  count3: '발신 준비',
  count2: '발신 준비',
  count1: '발신 준비',
  dialing: '발신 중…',
  connected: '통화 연결됨 · 상담 시작',
};

export function DialOverlay({ customerName, phone, onConnected, answered }: DialOverlayProps) {
  const [phase, setPhase] = useState<DialPhase>('count3');
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;
  // 폴백 전환이 이미 한 번 발생했는지 — 실제 수신 신호와 타이머가 경쟁할 때 onConnected
  // 가 두 번 호출되지 않도록 가드.
  const transitionedRef = useRef(false);

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
    // 폴백: 실제 수신 신호가 끝내 오지 않아도(mock·데모) 흐름이 진행되도록.
    at(T_TRANSITION, () => {
      if (transitionedRef.current) return;
      transitionedRef.current = true;
      onConnectedRef.current();
    });

    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  // 실제 수신 신호(answered) 도착 → 카운트다운 도중이라도 즉시 '연결됨 ✓' 로 점프하고
  // 짧은 확인 후 전환. 폴백 타이머보다 먼저 도착하면 이쪽이 전환을 가져간다.
  useEffect(() => {
    if (!answered || transitionedRef.current) return;
    setPhase('connected');
    const t = window.setTimeout(() => {
      if (transitionedRef.current) return;
      transitionedRef.current = true;
      onConnectedRef.current();
    }, T_ANSWERED_CONFIRM);
    return () => clearTimeout(t);
  }, [answered]);

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
