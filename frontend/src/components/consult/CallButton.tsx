// CallButton — 통화 버튼 (FRONTEND-002 / #31).
// onClick → dialCall AppSync mutation → state=DIALING → /calls/[id] 전환.
// 자동 발신 없음: mount만으로는 dialCall을 호출하지 않는다.
// 디자인 SSOT: docs/consult_redesigned-3.html #view-segment .sg-btn--call
'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import { useRouter } from 'next/navigation';
import { dialCall } from '@/lib/appsync';

type CallButtonProps = {
  /** 발신 대상 고객 id. dialCall(customerId)이 새 통화를 생성한다. */
  customerId: string;
  /** 분석 완료 여부. false 이면 버튼이 disabled 상태로 렌더된다. */
  analysisComplete?: boolean;
  /**
   * 발신 성공 시 통화 연결 오버레이를 띄울 콜백. 제공되면 즉시 라우팅하지 않고
   * 이 콜백에 발신된 callId 를 넘긴다(연결 연출 후 호출자가 라우팅).
   * 미제공이면 기존 동작대로 곧장 /calls/[id] 로 이동한다.
   */
  onConnecting?: (callId: string) => void;
};

type ButtonState = 'idle' | 'dialing' | 'error';

// 백엔드 INVALID_STATE 메시지에서 기존 활성 콜 id 추출.
// Amplify 는 GraphQL 에러를 { errors: [{ message }] } 로 reject 하며, 메시지는
// "INVALID_STATE: customer cust-001 already has an active call (c123...)" 형태다.
function existingCallIdFromError(err: unknown): string | null {
  const messages: string[] = [];
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; errors?: Array<{ message?: unknown }> };
    if (Array.isArray(e.errors)) {
      for (const ge of e.errors) {
        if (typeof ge?.message === 'string') messages.push(ge.message);
      }
    }
    if (typeof e.message === 'string') messages.push(e.message);
  }
  for (const m of messages) {
    const match = m.match(/already has an active call \(([^)]+)\)/);
    if (match) return match[1];
  }
  return null;
}

export function CallButton({ customerId, analysisComplete = true, onConnecting }: CallButtonProps) {
  const router = useRouter();
  const [btnState, setBtnState] = useState<ButtonState>('idle');

  const handleClick = async () => {
    if (btnState === 'dialing') return;
    setBtnState('dialing');
    try {
      const result = await dialCall(customerId);
      if (result.state === 'DIALING' || result.callId) {
        // 연결 오버레이 핸들러가 있으면 라우팅을 위임(연결 연출 후 이동),
        // 없으면 기존처럼 곧장 상담 화면으로 이동한다.
        if (onConnecting) {
          onConnecting(result.callId);
          return;
        }
        router.push(`/calls/${result.callId}`);
      }
    } catch (err) {
      // 이미 *연결된* 콜이 있으면 백엔드가 INVALID_STATE 로 거부하며 메시지에 기존
      // callId 를 싣는다("...already has an active call (c123...)"). 발신 버튼을 누른
      // 의도는 그 통화로 진입하는 것이므로, 새 발신 대신 기존 콜 모니터링으로 이동한다.
      const existing = existingCallIdFromError(err);
      if (existing) {
        router.push(`/calls/${existing}`);
        return;
      }
      console.error('dialCall 오류', err);
      setBtnState('error');
    }
  };

  const disabled = !analysisComplete || btnState === 'dialing';

  return (
    <button
      type="button"
      className={clsx(
        // sg-btn base
        'mt-[14px] inline-flex items-center gap-1.5 rounded-[10px] border px-5 py-[9px]',
        'font-disp text-[13px] font-bold transition-all duration-[180ms]',
        // sg-btn--call: enabled
        !disabled && [
          'cursor-pointer border-route bg-route text-white',
          'hover:-translate-y-px hover:shadow-[0_6px_16px_-6px_rgba(53,81,214,0.6)]',
        ],
        // sg-btn--call: disabled — muted gray via tokens
        disabled && [
          'cursor-default border-[var(--line)] bg-[var(--canvas-2)] text-ink-faint',
        ],
      )}
      disabled={disabled}
      onClick={handleClick}
      data-testid="call-button"
      data-state={btnState}
    >
      <i className="ti ti-phone text-[15px]" aria-hidden="true" />
      {btnState === 'dialing' ? '발신 중…' : '발신하기'}
    </button>
  );
}
