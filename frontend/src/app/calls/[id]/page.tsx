// ConsultCockpit — 상담 코크핏 페이지 (FRONTEND-007 / #36)
// SSOT: docs/consult_redesigned-3.html
//
// 레이아웃:
//   .cockpit  → 2열 (좌: STT placeholder / 우: rightcol)
//   .rightcol → 2행 (위: JourneyMap / 아래: cc__body → cc__cards 3열)
//
// cc__cards 3열:
//   ① 고객발화분석 — SpeechAnalysis
//   ② DB 분석     — placeholder (DB분석 전용 FE issue 없음)
//   ③ 컴플라이언스 체크 — CompliancePanel
//
// next-action 독립 카드 없음 (SSOT 재정렬 2026-06-22).
'use client';

import { use } from 'react';
import { SpeechAnalysis } from '@/components/consult/SpeechAnalysis';
import { CompliancePanel } from '@/components/consult/CompliancePanel';
import { JourneyMap } from '@/components/consult/JourneyMap';

// Next.js 15: 동적 라우트 params는 Promise — client component에서 use()로 언래핑.
type PageProps = {
  params: Promise<{ id: string }>;
};

export default function ConsultCockpitPage({ params }: PageProps) {
  const { id: callId } = use(params);

  return (
    <div className="cockpit grid grid-cols-[0.40fr_1.60fr] gap-[11px] items-stretch">

      {/* ═══ 좌: STT (콜봇 통화중) ═══ */}
      <div className="stt glass-card flex flex-col">
        <div className="stt__head p-3 border-b border-[var(--hair)]">
          <div className="act-bg flex items-center justify-between">
            <span className="act-ai flex items-center gap-1.5 text-sm font-semibold text-ink">
              <span className="ai-ic">🤖</span>
              <span className="ai-tx leading-tight text-xs">AI 상담<br />진행 중</span>
            </span>
            <span className="act-right flex items-center gap-2 text-xs text-ink-faint">
              <span className="act-live flex items-center gap-1">
                <span className="d inline-block h-1.5 w-1.5 rounded-full bg-danger" />
                LIVE
              </span>
              <span className="act-timer font-mono" id="timer">00:00</span>
            </span>
          </div>
        </div>
        <div className="stt__body flex-1 overflow-y-auto p-3" id="chat">
          <p className="text-xs text-ink-faint">STT 화면</p>
        </div>
        <div className="stt__foot flex items-center justify-end gap-2 border-t border-[var(--hair)] p-2">
          <button className="ghost-btn rounded px-2 py-1 text-xs text-ink-faint hover:bg-[var(--card-soft)]" id="restart">
            ↻ 처음부터
          </button>
          <button className="next-btn rounded bg-route px-3 py-1 text-xs font-semibold text-white" id="next">
            다음 발화 <span className="kbd">↵</span>
          </button>
        </div>
      </div>

      {/* ═══ 우: rightcol (위 항법 / 아래 AI응답준비) ═══ */}
      <div className="rightcol grid grid-rows-[36fr_64fr] gap-[13px] min-h-0">

        {/* ── 우-상단: 여정 맵 ── */}
        <div className="map glass-card overflow-hidden">
          <div className="map__title flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-ink border-b border-[var(--hair)]">
            <span className="hicon">
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
                <circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.9" />
              </svg>
            </span>
            <span>상담 여정</span>
          </div>
          <JourneyMap callId={callId} disableLiveData={false} />
        </div>

        {/* ── 우-하단: AI응답준비 (cc__body → cc__cards 3열) ── */}
        <div className="cc__body flex flex-col gap-[11px] p-[7px_8px_13px] min-h-0">
          <div
            className="cc__cards flex-1 grid grid-cols-3 gap-[12px] min-h-0"
            data-testid="cc-cards"
          >

            {/* 카드① 고객발화분석 — SpeechAnalysis */}
            <div
              className="card idle flex flex-col min-h-0 overflow-hidden"
              id="card-emo"
              data-testid="cc-card"
            >
              <SpeechAnalysis callId={callId} disableLiveData={false} />
            </div>

            {/* 카드② DB 분석 — placeholder (전용 FE issue 없음) */}
            <div
              className="card idle glass-card flex flex-col min-h-0 overflow-hidden p-3"
              id="card-db"
              data-testid="cc-card"
            >
              <div className="card__h flex items-center gap-2 mb-2">
                <span className="card__no font-mono text-[10px] font-bold text-ink-faint">2</span>
                <span className="card__t font-disp text-sm font-semibold text-ink">DB 분석</span>
              </div>
              <div className="card-scroll flex-1 overflow-y-auto flex flex-col gap-2">
                <div className="cseclbl flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-wider text-ink-faint">
                  <span>사용 데이터</span>
                  <span className="ln flex-1 border-t border-[var(--hair)]" />
                </div>
                <div className="usebox" id="dbUse">
                  <p className="text-xs text-ink-faint">데이터 로딩 대기 중</p>
                </div>
                <div className="usedivider flex items-center justify-center py-1 text-[11px] text-ink-faint" id="dbBridge">
                  <span>▼</span>
                </div>
                <div className="cseclbl flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-wider text-ink-faint">
                  <span>데이터 분석 결과</span>
                  <span className="ln flex-1 border-t border-[var(--hair)]" />
                </div>
                <div className="resbox" id="dbRes">
                  <p className="text-xs text-ink-faint">분석 결과 대기 중</p>
                </div>
              </div>
            </div>

            {/* 카드③ 컴플라이언스 체크 — CompliancePanel */}
            <div
              className="card idle flex flex-col min-h-0 overflow-hidden"
              id="card-strat"
              data-testid="cc-card"
            >
              <CompliancePanel callId={callId} disableLiveData={false} />
            </div>

          </div>{/* /cc__cards */}
        </div>{/* /cc__body */}

      </div>{/* /rightcol */}

    </div>
  );
}
