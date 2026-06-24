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
import { stopBotAudio, isBotSpeaking } from '@/lib/botAudioControl';
import { useExperienceStore } from '@/stores/experienceStore';
import { SCENARIO_CUSTOMER_NAME } from '@/lib/customerProfiles';
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
  /**
   * 통화 종료(초록 ✓) 클릭 시 동작. 미지정 시 관리자 CRM 상세(/crm/{callId})로 이동.
   * 모바일 체험(/m)은 CRM이 없으므로 별도 종료 화면으로 보내는 등 호출자가 주입한다.
   */
  onEnded?: () => void;
  /**
   * VAD 임계값 초기값. 미지정 시 VAD_DEFAULT(관리자/데스크톱 기준). 모바일은 스피커-마이크
   * 근접·소음 환경상 더 민감하게(낮게) 시작하려고 호출자가 주입한다.
   */
  initialVadThreshold?: number;
  /**
   * 체험 고객 이름. 라이브 백엔드(exp-* 콜)는 DynamoDB에 고객 레코드가 없어 AI가 이름을
   * 몰라 <고객명> placeholder를 내뱉는다. startAudio로 함께 넘겨 백엔드가 최소 고객
   * 컨텍스트를 만들게 한다(미지정이면 기존 동작 — 이름 없이 시작).
   */
  customerName?: string;
};

// VAD 임계값 슬라이더 범위 — 낮을수록 작은 소리도 발화로 인식(민감).
const VAD_MIN = 0;
const VAD_MAX = 0.2;
const VAD_DEFAULT = 0.14;

// 발화 후 이만큼(ms) 연속 침묵하면 발화 종료(flush)로 본다. pcmCapture 기본값(1200)은
// 종료 인식이 체감상 느려, 발화 끝~화면 표시 지연을 줄이려고 700으로 명시 하향.
const SILENCE_MS = 700;

// "..." 타이핑 인디케이터 — Agent가 응답을 생성 중일 때(고객 턴 직후) AI 말풍선에 노출.
// 점 3개가 stagger 애니메이션으로 깜빡인다(키프레임 typingDot은 LiveSession이 <style>로 주입).
function TypingDots() {
  return (
    <span aria-hidden style={{ display: 'inline-flex', gap: '3px', alignItems: 'center', height: '1em' }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%',
            background: 'var(--ink-dim)', animation: `typingDot 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

export function LiveSession({ callId, onEnded, initialVadThreshold, customerName }: LiveSessionProps) {
  const router = useRouter();
  // 종료 동작: 호출자 주입(onEnded) 우선, 없으면 관리자 CRM 상세로 이동(기존 동작).
  const handleEnded = onEnded ?? (() => router.push(`/crm/${callId}`));
  const initialVad = initialVadThreshold ?? VAD_DEFAULT;
  const [micState, setMicState] = useState<MicState>('idle');
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [ended, setEnded] = useState(false);
  const [vadThreshold, setVadThreshold] = useState(initialVad);
  const streamRef = useRef<MediaStream | null>(null);
  const captureRef = useRef<PcmCaptureHandle | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // 슬라이더 값을 ref에 미러 — startPcmCapture에 함수형 임계값으로 넘겨
  // 캡처 재시작 없이 실시간 반영(매 프레임 ref.current를 읽음).
  const vadThresholdRef = useRef(initialVad);
  vadThresholdRef.current = vadThreshold;

  // 타이핑 인디케이터("...") + 타자기 스트리밍 상태.
  // 고객 턴 도착 → "..." 노출(Agent 실행 중). bot 텍스트 도착 즉시 → "..." 끄고 한 글자씩 reveal.
  const [typingIndicatorActive, setTypingIndicatorActive] = useState(false);
  const [revealSeq, setRevealSeq] = useState<number | null>(null);
  const [revealText, setRevealText] = useState('');
  const [revealTarget, setRevealTarget] = useState('');
  // 구독 콜백/인터벌 클로저가 최신값을 읽도록 ref 미러(매 렌더 동기화 — vadThresholdRef와 동일 규약).
  const revealSeqRef = useRef<number | null>(null);
  revealSeqRef.current = revealSeq;
  const revealTargetRef = useRef('');
  const revealLenRef = useRef(0);
  // 완료된 bot seq — MODIFY(같은 seq + audioUrl) 재발화가 타자기를 재시작하지 않게 차단.
  const completedRevealSeqsRef = useRef<Set<number>>(new Set());

  // seq로 멱등하게 말풍선 누적(re-emit 방지). 봇/고객 모두 표시(agent는 무시).
  const pushTurn = (turn: Pick<Turn, 'seq' | 'speaker' | 'text'>) => {
    if (turn.speaker !== 'customer' && turn.speaker !== 'bot') return;
    setBubbles((prev) =>
      prev.some((b) => b.seq === turn.seq && b.speaker === turn.speaker)
        ? prev
        : [...prev, { seq: turn.seq, speaker: turn.speaker, text: turn.text }],
    );
  };

  // onTurn 처리: 고객 턴 → "..." 노출, bot 텍스트 첫 도착 → 타자기 reveal 시작.
  // INSERT(텍스트만)/MODIFY(텍스트+audioUrl) 두 번 발화되므로 같은 seq 재진입을 차단(idempotent).
  // audioUrl 비의존 단일 규칙 — 라이브/mock(audioUrl:null 단발) 모두 동일 동작.
  const handleTurn = (turn: Pick<Turn, 'seq' | 'speaker' | 'text'>) => {
    if (turn.speaker === 'customer') {
      pushTurn(turn);
      setTypingIndicatorActive(true);
      return;
    }
    if (turn.speaker === 'bot' && turn.text) {
      if (revealSeqRef.current === turn.seq || completedRevealSeqsRef.current.has(turn.seq)) return;
      pushTurn(turn); // 전체 텍스트를 bubbles에 저장(dedup) — reveal 완료 후 그대로 렌더
      setTypingIndicatorActive(false);
      revealSeqRef.current = turn.seq;
      revealTargetRef.current = turn.text;
      revealLenRef.current = 0;
      setRevealSeq(turn.seq);
      setRevealText('');
      setRevealTarget(turn.text);
    }
    // agent speaker는 표시하지 않음.
  };

  const requestMic = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMicState('unsupported');
      return;
    }
    setMicState('requesting');
    try {
      // echoCancellation 필수 — 봇 TTS가 스피커로 나가면 마이크가 그 소리를 되먹어
      // VAD가 '고객 발화'로 오인한다. 그러면 (1) onSpeechStart→stopBotAudio로 봇이
      // 자기 음성에 스스로 barge-in 당해 잘리고 (2) 되먹은 봇 음성이 STT로 흘러
      // 유령 customer turn을 만들어 그래프가 한 번 더 돈다. AEC가 참조신호(봇 출력)만
      // 제거하므로 실제 고객 발화 barge-in은 그대로 동작한다. noiseSuppression/AGC도 켜
      // 잡음 오탐을 줄인다.
      // 표준 3종(AEC/NS/AGC)에 더해, 지원 브라우저에서만 적용되는 강화 힌트를
      // advanced로 얹는다. 모바일 스피커-마이크 근접 배치에서 봇 음성 되먹임을 더
      // 강하게 제거하려는 목적 — 미지원 브라우저는 advanced 항목을 조용히 무시한다.
      // 비표준 키(google*, voiceIsolation)는 MediaTrackConstraints 타입에 없어 캐스팅.
      const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        // Chrome 계열 비표준 힌트(구버전 WebRTC 제약). 신버전은 위 표준키로 대체되나
        // 모바일 Chrome/WebView에서 여전히 효과가 있는 경우가 있어 함께 요청한다.
        googEchoCancellation: true,
        googAutoGainControl: true,
        googNoiseSuppression: true,
        // 일부 최신 브라우저의 음성 격리(있으면 봇 에코 억제에 가장 효과적).
        voiceIsolation: true,
      } as unknown as MediaTrackConstraints;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      streamRef.current = stream;
      setMicState('listening');

      // 라이브 세션 시작 + PCM 스트리밍. 실패는 통화 UI를 막지 않게 삼킨다.
      // 체험 고객 이름을 함께 넘겨 백엔드가 최소 고객 컨텍스트를 만들게 한다 — 없으면
      // AI가 이름을 몰라 인사말에 <고객명> placeholder를 내뱉는다.
      void startAudio(callId, customerName).catch(() => {});
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
          // 발화 종료 침묵 대기 — 기본 1200ms는 종료 인식이 느려 700ms로 단축.
          silenceMs: SILENCE_MS,
          // barge-in: 고객이 다시 말하기 시작하면 재생 중인 봇 음성을 즉시 끊는다.
          onSpeechStart: () => stopBotAudio(),
          // 에코 게이팅: 봇 음성이 스피커로 나가는 중(+꼬리 가드)에는 VAD 임계값을
          // 올려, 모바일 근접 배치에서 되먹임 에코가 유령 고객 발화로 잡히는 걸 막는다.
          // 큰 목소리의 진짜 barge-in은 그대로 통과(suppressGain 배수까지만 상향).
          isSuppressed: () => isBotSpeaking(),
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
      (turn) => handleTurn(turn),
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
      // 세션 전환 시 타이핑/타자기 상태 전부 리셋.
      setTypingIndicatorActive(false);
      setRevealSeq(null);
      setRevealText('');
      setRevealTarget('');
      revealSeqRef.current = null;
      revealLenRef.current = 0;
      completedRevealSeqsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  // 타자기 효과: revealSeq가 설정되면 revealTarget을 한 글자씩(틱마다 몇 글자) 노출.
  // 완료 시 revealSeq=null로 되돌려 일반 bubble 렌더로 복귀하고, 완료 seq를 기록(MODIFY 재발화 차단).
  useEffect(() => {
    if (revealSeq === null) return;
    const CHARS_PER_TICK = 3;
    const TICK_MS = 50; // ~60자/초
    const id = setInterval(() => {
      revealLenRef.current = Math.min(revealLenRef.current + CHARS_PER_TICK, revealTargetRef.current.length);
      setRevealText(revealTargetRef.current.slice(0, revealLenRef.current));
      if (revealLenRef.current >= revealTargetRef.current.length) {
        clearInterval(id);
        completedRevealSeqsRef.current.add(revealSeq);
        revealSeqRef.current = null;
        setRevealSeq(null);
      }
    }, TICK_MS);
    return () => clearInterval(id);
    // revealTarget 변경 시 재실행 → 구 인터벌 cleanup 후 새 발화로 시작.
  }, [revealSeq, revealTarget]);

  // mock 데모: 마이크 권한이 잡히면(listening) 백엔드가 없으므로 캔드 교환을 시뮬레이션.
  // 실 배포(live 백엔드)에서는 onTurn 실데이터가 들어오므로 이 분기는 건너뛴다.
  // 인사말 이름은 체험 고객 입력값(experienceStore) 우선, 없으면 기본 박서준.
  useEffect(() => {
    if (!IS_MOCK || micState !== 'listening') return;
    const custName =
      useExperienceStore.getState().getCustomer(callId)?.name || SCENARIO_CUSTOMER_NAME;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(() => { if (!cancelled) fn(); }, ms));
    at(900, () => handleTurn({ seq: 1, speaker: 'customer', text: '여보세요?' }));
    at(2200, () => handleTurn({ seq: 2, speaker: 'bot', text: `안녕하세요, 현대캐피탈 AI 상담원입니다. 본 서비스는 AI가 생성한 음성을 통해 제공되며, 상담내용은 녹음됨을 안내드립니다. 실례지만 ${custName} 고객님이 맞으세요?` }));
    return () => { cancelled = true; timers.forEach(clearTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micState, callId]);

  // 새 말풍선/타이핑 인디케이터/타자기 진행 시 하단 스크롤.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [bubbles, typingIndicatorActive, revealText]);

  const hasTranscript = bubbles.length > 0;

  return (
    <section
      data-testid="live-session"
      data-mic-state={micState}
      className="relative flex flex-1 flex-col min-h-0"
    >
      {/* 타이핑 인디케이터(점)·타자기 커서 키프레임 — 인라인 스타일 규약상 여기서 1회 주입. */}
      <style>{`@keyframes typingDot{0%,80%,100%{opacity:.2;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}@keyframes blinkCursor{50%{opacity:0}}`}</style>

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
          <>
            {bubbles.map((b) => {
              // 타자기 진행 중인 봇 말풍선이면 전체 text 대신 revealText + 깜빡이는 커서를 렌더.
              const isRevealing = b.speaker === 'bot' && b.seq === revealSeq;
              return (
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
                    {isRevealing ? (
                      <>
                        {revealText}
                        <span
                          aria-hidden
                          style={{
                            display: 'inline-block', width: '2px', height: '1em', marginLeft: '1px',
                            background: 'var(--ink)', verticalAlign: 'text-bottom',
                            animation: 'blinkCursor 0.7s step-end infinite',
                          }}
                        />
                      </>
                    ) : (
                      b.text
                    )}
                  </div>
                </div>
              );
            })}

            {/* "..." 타이핑 인디케이터 — 고객 턴 직후 Agent 실행 중에만. 타자기 시작 시 사라짐. */}
            {typingIndicatorActive && revealSeq === null && (
              <div data-testid="live-bubble-typing" className="flex flex-col gap-0.5 items-end">
                <span className="text-[10px] font-bold" style={{ color: 'var(--ink-faint)' }}>🤖 AI</span>
                <div
                  className="max-w-[85%] rounded-[12px] px-[12px] py-[8px] text-[13px] leading-[1.45]"
                  style={{ background: 'rgba(255,255,255,.72)', color: 'var(--ink)', border: '1px solid var(--card-bd)' }}
                  aria-label="AI가 응답을 생성하고 있습니다"
                >
                  <TypingDots />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 통화 종료: 초록 ✓ 완료 버튼 → 클릭 시 상담 CRM 화면 이동(데모 종료 메타포와 동일). */}
      {ended ? (
        <div className="flex flex-col items-center gap-2 px-4 pb-4 pt-2">
          <button
            type="button"
            data-testid="live-ended-crm"
            aria-label="상담 종료"
            onClick={handleEnded}
            className="grid h-[56px] w-[56px] place-items-center rounded-full cursor-pointer transition-transform duration-200 hover:scale-105 active:scale-95"
            style={{ background: 'var(--go)', color: '#fff', boxShadow: '0 8px 20px -6px rgba(46,158,110,.55)' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ width: 26, height: 26 }} aria-hidden>
              <path d="M5 13l4 4L19 7" />
            </svg>
          </button>
          <span className="font-disp text-[12px] font-bold" style={{ color: 'var(--go)' }}>
            {onEnded ? '상담 종료' : '상담 종료 · 상담 CRM 보기'}
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
              step={0.005}
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
