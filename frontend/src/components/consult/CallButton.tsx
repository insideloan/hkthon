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
  callId: string;
  /** 분석 완료 여부. false 이면 버튼이 disabled 상태로 렌더된다. */
  analysisComplete?: boolean;
};

type ButtonState = 'idle' | 'dialing' | 'error';

export function CallButton({ callId, analysisComplete = true }: CallButtonProps) {
  const router = useRouter();
  const [btnState, setBtnState] = useState<ButtonState>('idle');

  const handleClick = async () => {
    if (btnState === 'dialing') return;
    setBtnState('dialing');
    try {
      const result = await dialCall(callId);
      if (result.state === 'DIALING' || result.callId) {
        router.push(`/calls/${result.callId}`);
      }
    } catch (err) {
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
      <i className="ti ti-phone-call" aria-hidden="true" />
      {btnState === 'dialing' ? '발신 중…' : '발신하기'}
    </button>
  );
}
