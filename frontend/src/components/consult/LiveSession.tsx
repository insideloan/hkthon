// LiveSession — 라이브 상담 진입 패널 (FRONTEND, 1차 증분).
//
// 체험 큐 행(exp-*) 클릭 → /calls/[id]?live=1 진입 시 mock 시나리오 엔진 대신 이
// 패널이 뜬다. 아웃바운드 콜이 "연결"되면 브라우저가 마이크를 받아 고객 발화를
// 기다린다 — 사용자가 "여보세요"라고 말하면 그때부터 STT→agent→TTS 라이브
// 파이프라인이 시작된다(STT/agent/TTS 실연동은 다음 증분).
//
// 이 컴포넌트는 마이크 권한 획득 + 상태 표시(준비/수신 대기/거부/오류)까지 담당.
'use client';

import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';

type MicState =
  | 'idle' // 아직 권한 요청 전
  | 'requesting' // getUserMedia 대기 중
  | 'listening' // 권한 획득, 고객 발화("여보세요") 대기
  | 'denied' // 사용자가 마이크 거부
  | 'unsupported' // 브라우저가 getUserMedia 미지원
  | 'error'; // 그 외 오류

type LiveSessionProps = {
  callId: string;
};

export function LiveSession({ callId }: LiveSessionProps) {
  const [micState, setMicState] = useState<MicState>('idle');
  const streamRef = useRef<MediaStream | null>(null);

  // 마이크 권한 요청. 사용자 제스처(진입) 직후 호출되므로 자동재생/권한 정책에 유리.
  const requestMic = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMicState('unsupported');
      return;
    }
    setMicState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setMicState('listening');
      // 실제 오디오 스트리밍(STT)·agent·TTS 연동은 다음 증분에서 이 스트림을 사용한다.
    } catch (err) {
      // NotAllowedError/SecurityError → 거부, 그 외 → 오류.
      const name = (err as { name?: string } | null)?.name;
      setMicState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error');
    }
  };

  // 진입 시 자동으로 1회 권한 요청. 언마운트 시 트랙 정리(마이크 표시등 끔).
  useEffect(() => {
    void requestMic();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // callId가 바뀌면 새 세션으로 재요청.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  return (
    <section
      data-testid="live-session"
      data-mic-state={micState}
      className="flex flex-col items-center justify-center gap-5 px-6 py-12 text-center"
    >
      {/* 상단 상태 배지 */}
      <div
        className="inline-flex items-center gap-2 rounded-full px-[14px] py-[7px] font-disp text-[13px] font-bold"
        style={{
          color: micState === 'listening' ? 'var(--danger)' : 'var(--route)',
          background: micState === 'listening' ? 'rgba(219,83,80,.12)' : 'var(--badge-bg)',
          border: '1px solid var(--card-bd)',
        }}
      >
        <span
          className={clsx('h-[10px] w-[10px] flex-none rounded-full', micState === 'listening' && 'animate-pulse')}
          style={{ background: micState === 'listening' ? 'var(--danger)' : 'var(--route)' }}
          aria-hidden
        />
        {micState === 'listening' ? '● LIVE · 라이브 통화' : '라이브 통화 준비'}
      </div>

      {/* 마이크 아이콘 (원형) */}
      <div
        className="grid h-[96px] w-[96px] place-items-center rounded-full"
        style={{
          background: micState === 'listening' ? 'var(--danger)' : 'rgba(120,126,138,.92)',
          color: '#fff',
          boxShadow:
            micState === 'listening'
              ? '0 10px 28px -8px rgba(219,83,80,.55)'
              : '0 8px 20px -6px rgba(0,0,0,.35)',
        }}
        aria-hidden
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 40, height: 40 }}>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
        </svg>
      </div>

      {/* 안내 문구 — 상태별 */}
      <div className="flex flex-col gap-1">
        {micState === 'requesting' && (
          <p className="font-disp text-[16px] font-extrabold text-ink">마이크 권한을 확인하는 중…</p>
        )}
        {micState === 'listening' && (
          <>
            <p className="font-disp text-[18px] font-extrabold text-ink">
              연결되었습니다. <span className="text-route">“여보세요”</span> 라고 말씀해 주세요.
            </p>
            <p className="text-[13px] text-ink-dim">
              고객님의 첫 응답을 인식하면 AI 상담이 시작됩니다.
            </p>
          </>
        )}
        {micState === 'denied' && (
          <>
            <p className="font-disp text-[16px] font-extrabold text-danger">마이크 권한이 거부되었습니다.</p>
            <p className="text-[13px] text-ink-dim">브라우저 주소창의 마이크 권한을 허용한 뒤 다시 시도해 주세요.</p>
          </>
        )}
        {micState === 'unsupported' && (
          <p className="font-disp text-[16px] font-extrabold text-danger">
            이 브라우저는 마이크 입력을 지원하지 않습니다.
          </p>
        )}
        {micState === 'error' && (
          <p className="font-disp text-[16px] font-extrabold text-danger">
            마이크를 시작하지 못했습니다. 다시 시도해 주세요.
          </p>
        )}
      </div>

      {/* 재시도 버튼 — 거부/오류/미지원 상태에서 노출 */}
      {(micState === 'denied' || micState === 'error' || micState === 'unsupported') && (
        <button
          type="button"
          data-testid="live-retry"
          onClick={() => void requestMic()}
          className="cursor-pointer rounded-[10px] px-5 py-[9px] font-disp text-[13px] font-bold text-white"
          style={{ background: 'var(--route)', boxShadow: '0 4px 12px -3px rgba(44,91,214,.5)' }}
        >
          마이크 다시 요청
        </button>
      )}

      <span className="font-mono text-[10.5px] text-ink-faint">call · {callId}</span>
    </section>
  );
}
