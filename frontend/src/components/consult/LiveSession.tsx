// LiveSession — 라이브 상담 패널 (FRONTEND, 2차 증분: 마이크 스트리밍 + 트랜스크립트).
//
// 체험 큐 행(exp-*) 클릭 → /calls/[id]?live=1 진입 시 mock 시나리오 엔진 대신 이
// 패널이 뜬다. 흐름:
//   1) 마이크 권한 획득(getUserMedia)
//   2) startAudio(callId) 로 라이브 세션 시작
//   3) 마이크 PCM(16k) 청크를 audioChunk(callId, base64)로 스트리밍
//   4) onTurn 구독 → customer/bot 말풍선 렌더 (봇 오디오는 useBotAudioPlayback이 재생)
//
// 라이브 백엔드(ORCHESTRATOR_MODE=live)가 STT→agent(haiku)→TTS를 구동한다. mock
// 빌드에서는 백엔드가 없으므로, 진입 직후 "여보세요" → AI 인사 캔드 교환을 로컬에서
// 시뮬레이션해 오프라인 데모가 가능하게 한다(실 배포 시 onTurn 실데이터로 대체).
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { startAudio, audioChunk, subscribeTurns, subscribeCallEnded } from '@/lib/appsync';
import { startPcmCapture, type PcmCaptureHandle, type PcmVadEvent } from '@/lib/pcmCapture';
import type { Turn } from '@/types/realtime';

const IS_MOCK =
  process.env.NEXT_PUBLIC_USE_MOCK === '1' ||
  process.env.NEXT_PUBLIC_USE_MOCK === 'true';

type MicState =
  | 'idle'
  | 'requesting'
  | 'listening'
  | 'denied'
  | 'unsupported'
  | 'error';

type Bubble = { seq: number; speaker: Turn['speaker']; text: string };

type LiveSessionProps = {
  callId: string;
};

// VAD 임계값 슬라이더 범위 — 낮을수록 작은 소리도 발화로 인식(민감).
const VAD_MIN = 0.002;
const VAD_MAX = 0.03;
const VAD_DEFAULT = 0.006;

export function LiveSession({ callId }: LiveSessionProps) {
  const router = useRouter();
  const [micState, setMicState] = useState<MicState>('idle');
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [ended, setEnded] = useState(false);
  const [vadThreshold, setVadThreshold] = useState(VAD_DEFAULT);
  const streamRef = useRef<MediaStream | null>(null);
  const captureRef = useRef<PcmCaptureHandle | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // 슬라이더 값을 ref에 미러 — startPcmCapture에 함수형 임계값으로 넘겨
  // 캡처 재시작 없이 실시간 반영(매 프레임 ref.current를 읽음).
  const vadThresholdRef = useRef(VAD_DEFAULT);
  vadThresholdRef.current = vadThreshold;

  // seq로 멱등하게 말풍선 누적(re-emit 방지). 봇/고객 모두 표시(agent는 무시).
  const pushTurn = (turn: Pick<Turn, 'seq' | 'speaker' | 'text'>) => {
    if (turn.speaker !== 'customer' && turn.speaker !== 'bot') return;
    setBubbles((prev) =>
      prev.some((b) => b.seq === turn.seq && b.speaker === turn.speaker)
        ? prev
        : [...prev, { seq: turn.seq, speaker: turn.speaker, text: turn.text }],
    );
  };

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

      // 라이브 세션 시작 + PCM 스트리밍. 실패는 통화 UI를 막지 않게 삼킨다.
      void startAudio(callId).catch(() => {});
      // VAD 튜닝 모드(?vadDebug=1): 실마이크로 말해보며 콘솔에서 RMS·flush를 관찰해
      // vadThreshold/silenceMs를 맞춘다. 플래그 없으면 onDebug 미전달(프로덕션 무영향).
      const vadDebug =
        typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('vadDebug') === '1';
      let peakRms = 0; // 발화 구간 최대 RMS — 임계값 잡는 기준
      captureRef.current = startPcmCapture(
        stream,
        (b64) => {
          void audioChunk(callId, b64).catch(() => {});
        },
        {
          // 함수형 임계값 — 슬라이더가 바꾼 ref를 매 프레임 읽어 재시작 없이 반영.
          vadThreshold: () => vadThresholdRef.current,
          ...(vadDebug
            ? {
                onDebug: (ev: PcmVadEvent) => {
                  if (ev.type === 'frame') {
                    if (ev.speaking) peakRms = Math.max(peakRms, ev.rms);
                    return; // 프레임 로그는 과다 — 집계만, speech-start/flush에서 출력
                  }
                  if (ev.type === 'speech-start') {
                    peakRms = 0;
                    console.log('[vad] speech-start (임계값', vadThresholdRef.current, ')');
                  } else if (ev.type === 'flush') {
                    console.log(
                      `[vad] flush reason=${ev.reason} dur=${Math.round(ev.durationMs)}ms ` +
                        `peakRMS=${peakRms.toFixed(4)} samples=${ev.samples}`,
                    );
                  }
                },
              }
            : {}),
        },
      );
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      setMicState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error');
    }
  };

  // 진입 시 1회 권한 요청 + onTurn 구독. 언마운트 시 정리.
  useEffect(() => {
    void requestMic();

    const unsubscribeTurns = subscribeTurns(
      callId,
      (turn) => pushTurn(turn),
      (err) => console.error('onTurn(live) 구독 오류', err),
    );

    // 통화 종료 → 초록 ✓ 노출 + 마이크 정리(클릭 시 CRM 전환).
    const unsubscribeEnded = subscribeCallEnded(
      callId,
      () => {
        setEnded(true);
        captureRef.current?.stop();
        captureRef.current = null;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      },
      (err) => console.error('onCallEnded(live) 구독 오류', err),
    );

    return () => {
      unsubscribeTurns();
      unsubscribeEnded();
      captureRef.current?.stop();
      captureRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  // mock 데모: 마이크 권한이 잡히면(listening) 백엔드가 없으므로 캔드 교환을 시뮬레이션.
  // 실 배포(live 백엔드)에서는 onTurn 실데이터가 들어오므로 이 분기는 건너뛴다.
  useEffect(() => {
    if (!IS_MOCK || micState !== 'listening') return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(() => { if (!cancelled) fn(); }, ms));
    at(900, () => pushTurn({ seq: 1, speaker: 'customer', text: '여보세요?' }));
    at(2200, () => pushTurn({ seq: 2, speaker: 'bot', text: '안녕하세요, 현대캐피탈 AI 상담원입니다. 박서준 고객님 맞으실까요?' }));
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [micState]);

  // 새 말풍선 도착 시 하단 스크롤.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [bubbles]);

  const hasTranscript = bubbles.length > 0;

  return (
    <section
      data-testid="live-session"
      data-mic-state={micState}
      className="relative flex flex-1 flex-col min-h-0"
    >
      {/* 상태 배지 */}
      <div className="flex items-center justify-center px-4 pt-3">
        <div
          className="inline-flex items-center gap-2 rounded-full px-[14px] py-[7px] font-disp text-[13px] font-bold"
          style={{
            color: ended ? 'var(--go)' : micState === 'listening' ? 'var(--danger)' : 'var(--route)',
            background: ended ? 'rgba(46,158,110,.12)' : micState === 'listening' ? 'rgba(219,83,80,.12)' : 'var(--badge-bg)',
            border: '1px solid var(--card-bd)',
          }}
        >
          <span
            className={clsx('h-[10px] w-[10px] flex-none rounded-full', !ended && micState === 'listening' && 'animate-pulse')}
            style={{ background: ended ? 'var(--go)' : micState === 'listening' ? 'var(--danger)' : 'var(--route)' }}
            aria-hidden
          />
          {ended ? '✓ 상담 종료' : micState === 'listening' ? '● LIVE · 라이브 통화' : '라이브 통화 준비'}
        </div>
      </div>

      {/* 본문: 트랜스크립트 또는 대기 안내 */}
      <div ref={bodyRef} className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4">
        {!hasTranscript ? (
          <div className="m-auto flex flex-col items-center gap-4 text-center">
            {/* 마이크 아이콘 */}
            <div
              className="grid h-[88px] w-[88px] place-items-center rounded-full"
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
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 38, height: 38 }}>
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
              </svg>
            </div>
            {micState === 'requesting' && (
              <p className="font-disp text-[16px] font-extrabold text-ink">마이크 권한을 확인하는 중…</p>
            )}
            {micState === 'listening' && (
              <>
                <p className="font-disp text-[17px] font-extrabold text-ink">
                  연결되었습니다. <span className="text-route">“여보세요”</span> 라고 말씀해 주세요.
                </p>
                <p className="text-[13px] text-ink-dim">고객님의 첫 응답을 인식하면 AI 상담이 시작됩니다.</p>
              </>
            )}
            {micState === 'denied' && (
              <>
                <p className="font-disp text-[16px] font-extrabold text-danger">마이크 권한이 거부되었습니다.</p>
                <p className="text-[13px] text-ink-dim">브라우저 주소창의 마이크 권한을 허용한 뒤 다시 시도해 주세요.</p>
              </>
            )}
            {micState === 'unsupported' && (
              <p className="font-disp text-[16px] font-extrabold text-danger">이 브라우저는 마이크 입력을 지원하지 않습니다.</p>
            )}
            {micState === 'error' && (
              <p className="font-disp text-[16px] font-extrabold text-danger">마이크를 시작하지 못했습니다. 다시 시도해 주세요.</p>
            )}
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
          </div>
        ) : (
          bubbles.map((b) => (
            <div
              key={`${b.speaker}-${b.seq}`}
              data-testid={`live-bubble-${b.speaker}`}
              className={clsx('flex flex-col gap-0.5', b.speaker === 'customer' ? 'items-start' : 'items-end')}
            >
              <span className="text-[10px] font-bold" style={{ color: 'var(--ink-faint)' }}>
                {b.speaker === 'customer' ? '👤 고객' : '🤖 AI'}
              </span>
              <div
                className="max-w-[85%] rounded-[12px] px-[12px] py-[8px] text-[13px] leading-[1.45]"
                style={
                  b.speaker === 'customer'
                    ? { background: 'var(--route)', color: '#fff' }
                    : { background: 'rgba(255,255,255,.72)', color: 'var(--ink)', border: '1px solid var(--card-bd)' }
                }
              >
                {b.text}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 통화 종료: 초록 ✓ 완료 버튼 → 클릭 시 상담 CRM 화면 이동(데모 종료 메타포와 동일). */}
      {ended ? (
        <div className="flex flex-col items-center gap-2 px-4 pb-4 pt-2">
          <button
            type="button"
            data-testid="live-ended-crm"
            aria-label="상담 종료 · 상담 CRM 화면으로 이동"
            onClick={() => router.push(`/crm/${callId}`)}
            className="grid h-[56px] w-[56px] place-items-center rounded-full cursor-pointer transition-transform duration-200 hover:scale-105 active:scale-95"
            style={{ background: 'var(--go)', color: '#fff', boxShadow: '0 8px 20px -6px rgba(46,158,110,.55)' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ width: 26, height: 26 }} aria-hidden>
              <path d="M5 13l4 4L19 7" />
            </svg>
          </button>
          <span className="font-disp text-[12px] font-bold" style={{ color: 'var(--go)' }}>
            상담 종료 · 상담 CRM 보기
          </span>
        </div>
      ) : (
        <span className="px-4 pb-2 text-center font-mono text-[10.5px] text-ink-faint">call · {callId}</span>
      )}

      {/* VAD 민감도 조절 — 우하단. 음성 인식이 안 되면 임계값을 낮춰(왼쪽) 더 민감하게.
          listening 중에만 노출(종료/대기 상태에선 숨김). 캡처 재시작 없이 실시간 반영. */}
      {micState === 'listening' && !ended && (
        <div
          data-testid="vad-threshold-control"
          className="absolute bottom-3 right-3 flex flex-col gap-1 rounded-[10px] px-3 py-2"
          style={{ background: 'var(--badge-bg)', border: '1px solid var(--card-bd)', backdropFilter: 'blur(4px)' }}
        >
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="vad-threshold" className="font-disp text-[10.5px] font-bold text-ink-dim">
              🎙 음성 감도
            </label>
            <span className="font-mono text-[10px] text-ink-faint" data-testid="vad-threshold-value">
              {vadThreshold.toFixed(3)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-ink-faint">민감</span>
            <input
              id="vad-threshold"
              data-testid="vad-threshold-slider"
              type="range"
              min={VAD_MIN}
              max={VAD_MAX}
              step={0.001}
              value={vadThreshold}
              onChange={(e) => setVadThreshold(Number(e.target.value))}
              className="w-[120px] cursor-pointer accent-[var(--route)]"
              aria-label="음성 인식 감도 (VAD 임계값)"
            />
            <span className="text-[9px] text-ink-faint">둔감</span>
          </div>
        </div>
      )}
    </section>
  );
}
