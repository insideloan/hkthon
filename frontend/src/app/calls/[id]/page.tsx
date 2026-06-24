// ConsultCockpit — AI 상담 코파일럿 화면 (FRONTEND-007 / #36).
// SSOT: docs/consult_redesigned-3.html #view-consult — 실제 React 구현.
//
// 18턴 시나리오 엔진(useConsultEngine)이 '다음 발화' 클릭마다 STT·여정맵·3카드를
// SSOT와 동일한 타이밍으로 채운다. 백엔드 불필요(추후 데이터 연동 시 엔진 교체).
//   · STT 말풍선·word reveal·차량 주행: imperative(ref) — 타이밍 핵심
//   · 카드 애니메이션: store 구독 → 선언적 렌더(engineMode)
'use client';

import { use, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { clsx } from 'clsx';
import { SpeechAnalysis } from '@/components/consult/SpeechAnalysis';
import { CompliancePanel } from '@/components/consult/CompliancePanel';
import { JourneyMap, type JourneyMapHandle } from '@/components/consult/JourneyMap';
import { DbCard } from '@/components/consult/DbCard';
import { SttTranscript } from '@/components/consult/SttTranscript';
import { LiveSession } from '@/components/consult/LiveSession';
import { useConsultEngine } from '@/consult-engine/useConsultEngine';
import { useConsultStore, type CardPhase } from '@/stores/consultStore';
import { useBotAudioPlayback } from '@/hooks/useBotAudioPlayback';
import { useQueueStore } from '@/stores/queueStore';
import { resolveScenarioCustomerName } from '@/lib/customerProfiles';

// 목/스크립트 데모 게이트 (lib/appsync.ts의 USE_MOCK과 동일 규약).
const IS_MOCK =
  process.env.NEXT_PUBLIC_USE_MOCK === '1' ||
  process.env.NEXT_PUBLIC_USE_MOCK === 'true';

type PageProps = { params: Promise<{ id: string }> };

// 카드 phase(store) → SSOT className(idle/run/run-risky/ok) 매핑 헬퍼.
function cardCls(phase: CardPhase): string {
  return clsx('card', phase === 'idle' && 'idle', phase === 'run' && 'run', phase === 'run-risky' && 'run risky', phase === 'ok' && 'ok');
}

const CARD_BASE = 'flex flex-col min-h-0 overflow-hidden';
const CARD_STYLE: React.CSSProperties = {
  position: 'relative', gap: '9px', border: '1px solid var(--hair)', borderRadius: '14px',
  background: 'rgba(255,255,255,.50)', padding: '11px 12px',
};
const CARD_NO_STYLE: React.CSSProperties = {
  width: '26px', height: '26px', borderRadius: '8px', fontSize: '14px', fontWeight: 700,
  background: 'var(--badge-bg)', color: '#000',
};
const CARD_T_STYLE: React.CSSProperties = { fontSize: '14px', fontWeight: 800, color: 'var(--title)', lineHeight: 1.1 };

// ── 중앙 원형 재생/일시정지 버튼 ────────────────────────────────────────────
// 발화 진행 컨트롤. 미디어 플레이어 메타포: 클릭 가능하면 ▶(play), 재생 중이면
// ❚❚(pause, dim). 상담 종료 시에는 초록 ✓(check) — 클릭하면 상담 CRM 화면으로
// 이동한다. 회색 원형 — SSOT 토큰 사용.
type PlayPauseButtonProps = {
  /** 시나리오 종료(모든 턴 소진). */
  ended: boolean;
  /** 재생/애니메이션 진행 중(클릭 비활성). */
  busy: boolean;
  /** 접근성 라벨(engine.btnLabel — 상담 시작/다음 발화/재생 중/상담 종료). */
  label: string;
  /** 진행 클릭(advance). */
  onClick: () => void;
  /** 종료 후 클릭 — 상담 CRM 화면으로 이동. */
  onEnded: () => void;
};

function PlayPauseButton({ ended, busy, label, onClick, onEnded }: PlayPauseButtonProps) {
  // 종료 시 버튼은 비활성이 아니라 CRM 이동 액션으로 전환된다(재생 중일 때만 비활성).
  const disabled = busy;
  const icon: 'play' | 'pause' | 'check' = ended ? 'check' : busy ? 'pause' : 'play';
  const ariaLabel = ended ? '상담 CRM 화면으로 이동' : label;
  return (
    <button
      type="button"
      id="next"
      className={clsx(
        'pointer-events-auto inline-grid place-items-center rounded-full cursor-pointer',
        'transition-all duration-200',
        !disabled && 'hover:scale-105 active:scale-95',
        disabled && 'cursor-default',
      )}
      onClick={ended ? onEnded : onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={ariaLabel}
      data-state={icon}
      style={{
        width: '64px', height: '64px',
        // 종료: 초록 원형 / 진행: 회색 원형. 살짝 떠 보이도록 soft shadow + 반투명 배경.
        background: ended ? 'var(--go)' : 'rgba(120,126,138,.92)',
        color: '#fff',
        border: '1px solid rgba(255,255,255,.5)',
        boxShadow: ended
          ? '0 8px 20px -6px rgba(46,158,110,.55)'
          : disabled ? '0 2px 8px -3px rgba(0,0,0,.25)' : '0 8px 20px -6px rgba(0,0,0,.4)',
        opacity: busy ? 0.6 : 1,
        backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      {icon === 'play' && (
        // ▶ — 시각 중심을 맞추려 살짝 오른쪽 이동.
        <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '26px', height: '26px', marginLeft: '3px' }} aria-hidden>
          <path d="M8 5v14l11-7z" />
        </svg>
      )}
      {icon === 'pause' && (
        <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '24px', height: '24px' }} aria-hidden>
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
      )}
      {icon === 'check' && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ width: '26px', height: '26px' }} aria-hidden>
          <path d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
}

export default function ConsultCockpitPage({ params }: PageProps) {
  const { id: callId } = use(params);
  const router = useRouter();
  // ?live=1 → 실제 라이브 세션(마이크→STT→agent→TTS). 미지정 시 mock 시나리오 재생.
  // 체험 큐 행(exp-*)이 ?live=1로 진입한다(OutboundQueueTable.rowHref).
  const searchParams = useSearchParams();
  const isLive = searchParams.get('live') === '1';

  const chatRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<JourneyMapHandle | null>(null);
  const cardEmoRef = useRef<HTMLElement | null>(null);

  // 클릭한 큐 레코드(callId)의 고객 이름으로 시나리오 인사말을 구성. 스토어에 행이
  // 없거나 데모 기본 경로면 원본 이름(박서준)을 유지한다.
  const row = useQueueStore((s) => s.rows.find((r) => r.callId === callId));
  const customerName = resolveScenarioCustomerName(callId, row);

  const engine = useConsultEngine({ chatRef, mapRef, cardEmoRef, callId, customerName });

  // 라이브 모드 봇 음성 재생: onTurn의 bot audioUrl(TTS mp3)을 순차 재생.
  // 목/스크립트 데모(NEXT_PUBLIC_USE_MOCK)에서는 비활성 — 단, ?live=1 진입(체험 고객)은
  // mock 빌드여도 실제 라이브 경로이므로 재생을 활성화한다.
  useBotAudioPlayback(callId, { disabled: IS_MOCK && !isLive });

  // 카드 phase 구독 (className 토글).
  const card1 = useConsultStore((s) => s.card1);
  const card2 = useConsultStore((s) => s.card2);
  const card3 = useConsultStore((s) => s.card3);

  return (
    <div
      className="cockpit grid items-stretch"
      style={{ gridTemplateColumns: '0.40fr 1.60fr', gap: '11px', height: 'max(560px, calc(100vh - 96px))' }}
    >
      {/* ═══ 좌: STT panel ═══ */}
      <div
        className="stt flex flex-col overflow-hidden"
        style={{
          height: 'max(560px, calc(100vh - 96px))',
          // STT 패널 배경 이미지 (public/phone_screen.png). 단색 폴백.
          backgroundImage: 'url(/phone_screen.png)',
          backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
          backgroundColor: '#f8f9fb', // 이미지 로드 전/투명 영역 폴백
          border: '1px solid var(--card-bd)',
          borderRadius: '18px', backdropFilter: 'blur(16px) saturate(1.08)', WebkitBackdropFilter: 'blur(16px) saturate(1.08)',
          boxShadow: 'var(--shadow)',
        }}
      >
        <div className="stt__head flex flex-col items-stretch" style={{ borderBottom: '1px solid var(--hair)' }}>
          <div className="act-bg flex flex-row items-center justify-between" style={{ padding: '10px 16px', background: 'rgba(231,236,252,.55)' }}>
            <span className="act-ai inline-flex items-center" style={{ gap: '9px' }}>
              <span className="ai-ic inline-grid place-items-center text-base flex-none" style={{ width: '30px', height: '30px', borderRadius: '9px', background: '#fff', boxShadow: '0 4px 12px -5px rgba(53,81,214,.6)' }}>🤖</span>
              <span className="ai-tx font-disp flex flex-col leading-tight" style={{ fontSize: '13.5px', fontWeight: 800, color: 'var(--route)', lineHeight: 1.2 }}>AI 상담<br />진행 중</span>
            </span>
            <span className="act-right inline-flex items-center flex-none" style={{ gap: '10px' }}>
              <span className="act-live font-mono inline-flex items-center" style={{ gap: '6px', fontSize: '10px', fontWeight: 700, letterSpacing: '.08em', color: 'var(--danger)' }}>
                <span className="d flex-none rounded-full" style={{ width: '8px', height: '8px', background: 'var(--danger)', animation: 'beatG 1.4s ease-out infinite' }} />
                LIVE
              </span>
              <span className="act-timer font-mono" id="timer" style={{ fontSize: '16px', fontWeight: 700, color: 'var(--route)', fontVariantNumeric: 'tabular-nums' }}>
                {engine.timer}
              </span>
            </span>
          </div>
        </div>

        {/* STT body. 라이브 모드(?live=1, 체험 고객)는 mock 재생 대신 마이크 캡처
            패널을 띄운다. 그 외(데모)는 시나리오 엔진 + 중앙 재생/일시정지 버튼. */}
        {isLive ? (
          <div className="stt__chat flex flex-1 min-h-0 overflow-y-auto">
            <LiveSession callId={callId} />
          </div>
        ) : (
          <>
            <div className="stt__chat relative flex flex-1 min-h-0">
              <div className="stt__body flex flex-col flex-1 overflow-y-auto" id="chat" style={{ padding: '10px 10px 6px', scrollBehavior: 'smooth' }}>
                <div ref={chatRef}>
                  <SttTranscript />
                </div>
              </div>
              {/* 원형 버튼 — 채팅 영역 상단(첫 "여보세요?" 말풍선과 같은 높이)에 가로
                  중앙 오버레이. 오버레이 자체는 클릭을 통과(pointer-events-none)시키고
                  버튼만 클릭 가능(pointer-events-auto). */}
              <div
                className="pointer-events-none absolute inset-0 flex items-start justify-center"
                style={{ paddingTop: '10px' }}
              >
                <PlayPauseButton
                  ended={engine.ended}
                  busy={engine.btnDisabled && !engine.ended}
                  label={engine.btnLabel}
                  onClick={engine.advance}
                  onEnded={() => router.push(`/crm/${callId}`)}
                />
              </div>
            </div>

            <div className="stt__foot flex items-center" style={{ padding: '10px 13px', borderTop: '1px solid var(--hair)', gap: '9px', minHeight: '46px', background: 'rgba(255,255,255,.42)' }}>
              <button
                className="ghost-btn font-mono cursor-pointer"
                id="restart"
                title="처음부터 다시 재생"
                onClick={engine.reset}
                style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ink-faint)', background: 'none', border: '1px solid var(--line)', borderRadius: '8px', padding: '7px 10px' }}
              >
                ↻ 처음부터
              </button>
            </div>
          </>
        )}
      </div>

      {/* ═══ 우: rightcol ═══ */}
      <div className="rightcol grid min-h-0" style={{ gridTemplateRows: '36fr 64fr', gap: '13px', height: 'max(560px, calc(100vh - 96px))' }}>
        {/* 우-상단: 여정 맵 */}
        <div className="map relative min-h-0 overflow-hidden" style={{ height: '100%', borderRadius: '18px', border: '1px solid var(--card-bd)', background: 'var(--card-solid)', backdropFilter: 'blur(20px) saturate(1.05)', WebkitBackdropFilter: 'blur(20px) saturate(1.05)', boxShadow: 'var(--shadow), inset 0 1px 0 rgba(255,255,255,.5)' }}>
          <div className="map__title absolute flex items-center z-[6]" style={{ top: '11px', left: '12px', gap: '8px' }}>
            <span className="hicon inline-grid place-items-center flex-none" style={{ width: '27px', height: '27px', borderRadius: '8px', background: 'var(--badge-bg)', color: 'var(--badge-ink)' }}>
              <svg viewBox="0 0 24 24" fill="none" style={{ width: '15px', height: '15px', display: 'block' }}>
                <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
                <circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.9" />
              </svg>
            </span>
            <span className="font-disp" style={{ fontWeight: 800, fontSize: '13.5px', color: 'var(--title)' }}>상담 여정</span>
          </div>
          <JourneyMap ref={mapRef} callId={callId} disableLiveData />
        </div>

        {/* 우-하단: AI 응답 준비 */}
        <div className="chaincard flex flex-col min-h-0 overflow-hidden" style={{ height: '100%', background: 'var(--card-solid)', border: '1px solid var(--card-bd)', borderRadius: '18px', backdropFilter: 'blur(20px) saturate(1.05)', WebkitBackdropFilter: 'blur(20px) saturate(1.05)', boxShadow: 'var(--shadow)' }}>
          <div className="cc__head flex items-center" style={{ gap: '8px', padding: '3px 14px' }}>
            <span className="hicon inline-grid place-items-center flex-none" style={{ width: '27px', height: '27px', borderRadius: '8px', background: 'var(--badge-bg)', color: 'var(--badge-ink)' }}>
              <svg viewBox="0 0 24 24" fill="none" style={{ width: '15px', height: '15px', display: 'block' }}>
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
            </span>
            <h2 className="font-disp" style={{ fontSize: '13.5px', fontWeight: 800, letterSpacing: '-.01em', margin: 0, color: 'var(--title)' }}>AI 응답 준비</h2>
          </div>

          <div className="cc__body flex flex-col flex-1 min-h-0" id="ccBody" style={{ gap: '11px', padding: '7px 8px 13px' }}>
            <div className="cc__cards flex-1 grid min-h-0" style={{ gridTemplateColumns: 'repeat(3,1fr)', gap: '12px' }} data-testid="cc-cards">
              {/* 카드① 고객발화분석 */}
              <div ref={cardEmoRef as React.Ref<HTMLDivElement>} className={clsx(cardCls(card1), CARD_BASE)} id="card-emo" data-testid="cc-card" style={CARD_STYLE}>
                <div className="card__h flex items-center" style={{ gap: '8px' }}>
                  <span className="card__no font-mono inline-grid place-items-center flex-none" style={CARD_NO_STYLE}>1</span>
                  <span className="card__t font-disp" style={CARD_T_STYLE}>고객발화분석</span>
                </div>
                {/* 라이브: AppSync 구독(onSpeechAnalysis/onStrategyUpdate/onIndexUpdate).
                    데모: 시나리오 엔진(card1Store) 기반 engineMode. */}
                <SpeechAnalysis callId={callId} engineMode={!isLive} />
              </div>

              {/* 카드② DB 분석 */}
              <div className={clsx(cardCls(card2), CARD_BASE)} id="card-db" data-testid="cc-card" style={CARD_STYLE}>
                <div className="card__h flex items-center" style={{ gap: '8px' }}>
                  <span className="card__no font-mono inline-grid place-items-center flex-none" style={CARD_NO_STYLE}>2</span>
                  <span className="card__t font-disp" style={CARD_T_STYLE}>DB 분석</span>
                </div>
                <DbCard live={isLive} callId={callId} />
              </div>

              {/* 카드③ 컴플라이언스 체크 */}
              <div className={clsx(cardCls(card3), CARD_BASE)} id="card-strat" data-testid="cc-card" style={CARD_STYLE}>
                <div className="card__h flex items-center" style={{ gap: '8px' }}>
                  <span className="card__no font-mono inline-grid place-items-center flex-none" style={CARD_NO_STYLE}>3</span>
                  <span className="card__t font-disp" style={CARD_T_STYLE}>컴플라이언스 체크</span>
                </div>
                {/* 라이브: onComplianceState 구독. 데모: engineMode.
                    SSOT 정렬: card-scroll은 CompliancePanel 내부에서 렌더(중복 래퍼 제거). */}
                <CompliancePanel callId={callId} engineMode={!isLive} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
