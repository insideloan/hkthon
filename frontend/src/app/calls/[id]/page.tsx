// ConsultCockpit — AI 상담 코파일럿 화면 (FRONTEND-007 / #36).
// SSOT: docs/consult_redesigned-3.html #view-consult — 실제 React 구현.
//
// 18턴 시나리오 엔진(useConsultEngine)이 '다음 발화' 클릭마다 STT·여정맵·3카드를
// SSOT와 동일한 타이밍으로 채운다. 백엔드 불필요(추후 데이터 연동 시 엔진 교체).
//   · STT 말풍선·word reveal·차량 주행: imperative(ref) — 타이밍 핵심
//   · 카드 애니메이션: store 구독 → 선언적 렌더(engineMode)
'use client';

import { use, useRef } from 'react';
import { clsx } from 'clsx';
import { SpeechAnalysis } from '@/components/consult/SpeechAnalysis';
import { CompliancePanel } from '@/components/consult/CompliancePanel';
import { JourneyMap, type JourneyMapHandle } from '@/components/consult/JourneyMap';
import { DbCard } from '@/components/consult/DbCard';
import { SttTranscript } from '@/components/consult/SttTranscript';
import { useConsultEngine } from '@/consult-engine/useConsultEngine';
import { useConsultStore, type CardPhase } from '@/stores/consultStore';
import { useBotAudioPlayback } from '@/hooks/useBotAudioPlayback';

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

export default function ConsultCockpitPage({ params }: PageProps) {
  const { id: callId } = use(params);

  const chatRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<JourneyMapHandle | null>(null);
  const cardEmoRef = useRef<HTMLElement | null>(null);

  const engine = useConsultEngine({ chatRef, mapRef, cardEmoRef, callId });

  // 라이브 모드 봇 음성 재생: onTurn의 bot audioUrl(TTS mp3)을 순차 재생.
  // 목/스크립트 데모(NEXT_PUBLIC_USE_MOCK)에서는 비활성 — 다른 라이브 구독과 동일한 게이트.
  useBotAudioPlayback(callId, { disabled: IS_MOCK });

  // 카드 phase 구독 (className 토글).
  const card1 = useConsultStore((s) => s.card1);
  const card2 = useConsultStore((s) => s.card2);
  const card3 = useConsultStore((s) => s.card3);
  const pipeSrc = useConsultStore((s) => s.pipeSrc);

  return (
    <div
      className="cockpit grid items-stretch"
      style={{ gridTemplateColumns: '0.40fr 1.60fr', gap: '11px', height: 'max(560px, calc(100vh - 96px))' }}
    >
      {/* ═══ 좌: STT panel ═══ */}
      <div
        className="stt flex flex-col overflow-hidden"
        style={{
          height: 'max(560px, calc(100vh - 96px))', background: '#F9F6EE', border: '1px solid var(--card-bd)',
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

        {/* STT body — steps-wrap에 엔진이 말풍선 주입 */}
        <div className="stt__body flex flex-col flex-1 overflow-y-auto" id="chat" style={{ padding: '10px 10px 6px', scrollBehavior: 'smooth' }}>
          <div ref={chatRef}>
            <SttTranscript />
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
          <button
            className={clsx('next-btn font-disp ml-auto flex items-center cursor-pointer', engine.ended && 'done')}
            id="next"
            onClick={engine.advance}
            disabled={engine.btnDisabled}
            style={{ fontSize: '13px', fontWeight: 600, color: '#fff', background: 'var(--route)', border: 'none', borderRadius: '9px', padding: '9px 16px', gap: '7px', boxShadow: '0 4px 12px -3px rgba(44,91,214,.5)', opacity: engine.btnDisabled ? 0.7 : 1 }}
          >
            {engine.btnLabel}
            <span className="kbd font-mono" style={{ fontSize: '9px', fontWeight: 700, opacity: 0.7, border: '1px solid rgba(255,255,255,.5)', borderRadius: '4px', padding: '0 4px' }}>↵</span>
          </button>
        </div>
      </div>

      {/* ═══ 우: rightcol ═══ */}
      <div className="rightcol grid min-h-0" style={{ gridTemplateRows: '36fr 64fr', gap: '13px', height: 'max(560px, calc(100vh - 96px))' }}>
        {/* 우-상단: 여정 맵 */}
        <div className="map relative min-h-0 overflow-hidden" style={{ height: '100%', borderRadius: '18px', border: '1px solid var(--card-bd)', background: '#F9F6EE', backdropFilter: 'blur(16px) saturate(1.08)', WebkitBackdropFilter: 'blur(16px) saturate(1.08)', boxShadow: 'var(--shadow), inset 0 1px 0 rgba(255,255,255,.5)' }}>
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
        <div className="chaincard flex flex-col min-h-0 overflow-hidden" style={{ height: '100%', background: '#F9F6EE', border: '1px solid var(--card-bd)', borderRadius: '18px', backdropFilter: 'blur(16px) saturate(1.08)', WebkitBackdropFilter: 'blur(16px) saturate(1.08)', boxShadow: 'var(--shadow)' }}>
          <div className="cc__head flex items-center" style={{ gap: '8px', padding: '3px 14px' }}>
            <span className="hicon inline-grid place-items-center flex-none" style={{ width: '27px', height: '27px', borderRadius: '8px', background: 'var(--badge-bg)', color: 'var(--badge-ink)' }}>
              <svg viewBox="0 0 24 24" fill="none" style={{ width: '15px', height: '15px', display: 'block' }}>
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
            </span>
            <span className="mk font-mono" style={{ fontSize: '8.5px', fontWeight: 700, letterSpacing: '.16em', color: 'var(--route)', border: '1.4px solid #C3D0EA', background: '#fff', borderRadius: '6px', padding: '2px 7px', textTransform: 'uppercase' }}>AI응답준비</span>
            <h2 className="font-disp" style={{ fontSize: '13.5px', fontWeight: 800, letterSpacing: '-.01em', margin: 0, color: 'var(--title)' }}>AI 응답 준비</h2>
            <span style={{ fontSize: '10.5px', color: 'var(--ink-faint)' }}>{pipeSrc ?? '발화 분석 · DB 조회 · 컴플라이언스'}</span>
          </div>

          <div className="cc__body flex flex-col flex-1 min-h-0" id="ccBody" style={{ gap: '11px', padding: '7px 8px 13px' }}>
            <div className="cc__cards flex-1 grid min-h-0" style={{ gridTemplateColumns: 'repeat(3,1fr)', gap: '12px' }} data-testid="cc-cards">
              {/* 카드① 고객발화분석 */}
              <div ref={cardEmoRef as React.Ref<HTMLDivElement>} className={clsx(cardCls(card1), CARD_BASE)} id="card-emo" data-testid="cc-card" style={CARD_STYLE}>
                <div className="card__h flex items-center" style={{ gap: '8px' }}>
                  <span className="card__no font-mono inline-grid place-items-center flex-none" style={CARD_NO_STYLE}>1</span>
                  <span className="card__t font-disp" style={CARD_T_STYLE}>고객발화분석</span>
                </div>
                <SpeechAnalysis callId={callId} engineMode />
              </div>

              {/* 카드② DB 분석 */}
              <div className={clsx(cardCls(card2), CARD_BASE)} id="card-db" data-testid="cc-card" style={CARD_STYLE}>
                <div className="card__h flex items-center" style={{ gap: '8px' }}>
                  <span className="card__no font-mono inline-grid place-items-center flex-none" style={CARD_NO_STYLE}>2</span>
                  <span className="card__t font-disp" style={CARD_T_STYLE}>DB 분석</span>
                </div>
                <DbCard />
              </div>

              {/* 카드③ 컴플라이언스 체크 */}
              <div className={clsx(cardCls(card3), CARD_BASE)} id="card-strat" data-testid="cc-card" style={CARD_STYLE}>
                <div className="card__h flex items-center" style={{ gap: '8px' }}>
                  <span className="card__no font-mono inline-grid place-items-center flex-none" style={CARD_NO_STYLE}>3</span>
                  <span className="card__t font-disp" style={CARD_T_STYLE}>컴플라이언스 체크</span>
                </div>
                <div className="card-scroll">
                  <CompliancePanel callId={callId} engineMode />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
