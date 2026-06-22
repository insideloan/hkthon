// ConsultCockpit — 상담 코크핏 페이지 (FRONTEND-007 / #36)
// SSOT: docs/consult_redesigned-3.html #view-consult
//
// 레이아웃:
//   .cockpit  → 2열 (좌: STT panel ~38% / 우: rightcol ~62%)
//   .rightcol → 2행 (위 36fr: .map JourneyMap / 아래 64fr: .chaincard)
//   .chaincard → .cc__head + .cc__body → .cc__cards 3열
//
// cc__cards 3열:
//   ① 고객발화분석 — SpeechAnalysis
//   ② DB 분석     — placeholder
//   ③ 컴플라이언스 체크 — CompliancePanel
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
    // .cockpit — SSOT: grid-template-columns:.40fr 1.60fr; gap:11px; align-items:stretch
    // height는 SSOT --h = max(560px, calc(100vh - 96px))
    <div
      className="cockpit grid items-stretch"
      style={{
        gridTemplateColumns: '0.40fr 1.60fr',
        gap: '11px',
        height: 'max(560px, calc(100vh - 96px))',
      }}
    >

      {/* ═══ 좌: STT panel ═══
          SSOT .stt — background:#F9F6EE; border:1px solid var(--card-bd);
          backdrop-filter:blur(16px) saturate(1.08); border-radius:18px; overflow:hidden;
          box-shadow:var(--shadow); height:var(--h); flex-direction:column */}
      <div
        className="stt flex flex-col overflow-hidden"
        style={{
          height: 'max(560px, calc(100vh - 96px))',
          background: '#F9F6EE',
          border: '1px solid var(--card-bd)',
          borderRadius: '18px',
          backdropFilter: 'blur(16px) saturate(1.08)',
          WebkitBackdropFilter: 'blur(16px) saturate(1.08)',
          boxShadow: 'var(--shadow)',
        }}
      >
        {/* .stt__head — SSOT: padding:0; border-bottom:1px solid var(--hair);
            flex-direction:column; align-items:stretch; gap:0 */}
        <div
          className="stt__head flex flex-col items-stretch"
          style={{ borderBottom: '1px solid var(--hair)' }}
        >
          {/* .act-bg — SSOT: flex-direction:row; align-items:center; justify-content:space-between;
              padding:10px 16px; background:rgba(231,236,252,.55) */}
          <div
            className="act-bg flex flex-row items-center justify-between"
            style={{ padding: '10px 16px', background: 'rgba(231,236,252,.55)' }}
          >
            {/* .act-ai — SSOT: inline-flex; gap:9px */}
            <span className="act-ai inline-flex items-center" style={{ gap: '9px' }}>
              {/* .ai-ic — SSOT: 30px×30px; border-radius:9px; background:#fff; box-shadow */}
              <span
                className="ai-ic inline-grid place-items-center text-base flex-none"
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '9px',
                  background: '#fff',
                  boxShadow: '0 4px 12px -5px rgba(53,81,214,.6)',
                }}
              >
                🤖
              </span>
              {/* .ai-tx — SSOT: font-family:var(--disp); font-size:13.5px; font-weight:800; color:var(--route) */}
              <span
                className="ai-tx font-disp flex flex-col leading-tight"
                style={{ fontSize: '13.5px', fontWeight: 800, color: 'var(--route)', lineHeight: 1.2 }}
              >
                AI 상담<br />진행 중
              </span>
            </span>

            {/* .act-right — SSOT: inline-flex; gap:10px; flex:none */}
            <span className="act-right inline-flex items-center flex-none" style={{ gap: '10px' }}>
              {/* .act-live — SSOT: font-family:var(--mono); font-size:10px; font-weight:700;
                  letter-spacing:.08em; color:var(--danger) */}
              <span
                className="act-live font-mono inline-flex items-center"
                style={{
                  gap: '6px',
                  fontSize: '10px',
                  fontWeight: 700,
                  letterSpacing: '.08em',
                  color: 'var(--danger)',
                }}
              >
                {/* .d — SSOT: 8px dot; animation:beatG 1.4s ease-out infinite */}
                <span
                  className="d flex-none rounded-full"
                  style={{
                    width: '8px',
                    height: '8px',
                    background: 'var(--danger)',
                    animation: 'beatG 1.4s ease-out infinite',
                  }}
                />
                LIVE
              </span>
              {/* .act-timer — SSOT: font-size:16px; font-weight:700; color:var(--route);
                  font-variant-numeric:tabular-nums */}
              <span
                className="act-timer font-mono"
                id="timer"
                style={{
                  fontSize: '16px',
                  fontWeight: 700,
                  color: 'var(--route)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                00:00
              </span>
            </span>
          </div>
        </div>

        {/* .stt__body — SSOT: flex:1; overflow-y:auto; padding:10px 10px 6px;
            flex-direction:column; scroll-behavior:smooth */}
        <div
          className="stt__body flex flex-col flex-1 overflow-y-auto"
          id="chat"
          style={{ padding: '10px 10px 6px', scrollBehavior: 'smooth' }}
        >
          {/* .jov-title — SSOT: font-size:9.5px; font-weight:800; color:var(--route);
              letter-spacing:.9px; text-transform:uppercase; margin-bottom:7px;
              padding-bottom:6px; border-bottom:1.5px solid #E8F0FE */}
          <div
            className="jov-title font-mono"
            style={{
              fontSize: '9.5px',
              fontWeight: 800,
              color: 'var(--route)',
              letterSpacing: '.9px',
              textTransform: 'uppercase',
              marginBottom: '7px',
              paddingBottom: '6px',
              borderBottom: '1.5px solid #E8F0FE',
            }}
          >
            STT 화면
          </div>
          <div id="steps-wrap" className="flex flex-col" />
        </div>

        {/* .stt__foot — SSOT: padding:10px 13px; border-top:1px solid var(--hair);
            flex; align-items:center; gap:9px; min-height:46px; background:rgba(255,255,255,.42) */}
        <div
          className="stt__foot flex items-center"
          style={{
            padding: '10px 13px',
            borderTop: '1px solid var(--hair)',
            gap: '9px',
            minHeight: '46px',
            background: 'rgba(255,255,255,.42)',
          }}
        >
          {/* .ghost-btn — SSOT: font-family:var(--mono); font-size:11px; font-weight:700;
              color:var(--ink-faint); background:none; border:1px solid var(--line);
              border-radius:8px; padding:7px 10px */}
          <button
            className="ghost-btn font-mono cursor-pointer"
            id="restart"
            title="처음부터 다시 재생"
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--ink-faint)',
              background: 'none',
              border: '1px solid var(--line)',
              borderRadius: '8px',
              padding: '7px 10px',
            }}
          >
            ↻ 처음부터
          </button>
          {/* .next-btn — SSOT: margin-left:auto; font-family:var(--disp); font-size:13px;
              font-weight:600; color:#fff; background:var(--route); border-radius:9px;
              padding:9px 16px; box-shadow:0 4px 12px -3px rgba(44,91,214,.5) */}
          <button
            className="next-btn font-disp ml-auto flex items-center cursor-pointer"
            id="next"
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: '#fff',
              background: 'var(--route)',
              border: 'none',
              borderRadius: '9px',
              padding: '9px 16px',
              gap: '7px',
              boxShadow: '0 4px 12px -3px rgba(44,91,214,.5)',
            }}
          >
            다음 발화{' '}
            {/* .kbd — SSOT: font-family:var(--mono); font-size:9px; font-weight:700;
                opacity:.7; border:1px solid rgba(255,255,255,.5); border-radius:4px; padding:0 4px */}
            <span
              className="kbd font-mono"
              style={{
                fontSize: '9px',
                fontWeight: 700,
                opacity: 0.7,
                border: '1px solid rgba(255,255,255,.5)',
                borderRadius: '4px',
                padding: '0 4px',
              }}
            >
              ↵
            </span>
          </button>
        </div>
      </div>

      {/* ═══ 우: rightcol ═══
          SSOT: grid-template-rows:36fr 64fr; gap:13px; min-height:0; height:var(--h) */}
      <div
        className="rightcol grid min-h-0"
        style={{
          gridTemplateRows: '36fr 64fr',
          gap: '13px',
          height: 'max(560px, calc(100vh - 96px))',
        }}
      >

        {/* ── 우-상단: 여정 맵 ── */}
        {/* .map — SSOT: position:relative; height:100%; min-height:0; border-radius:18px;
            overflow:hidden; border:1px solid var(--card-bd);
            background:#F9F6EE; backdrop-filter:blur(16px) saturate(1.08);
            box-shadow:var(--shadow), inset 0 1px 0 rgba(255,255,255,.5) */}
        <div
          className="map relative min-h-0 overflow-hidden"
          style={{
            height: '100%',
            borderRadius: '18px',
            border: '1px solid var(--card-bd)',
            background: '#F9F6EE',
            backdropFilter: 'blur(16px) saturate(1.08)',
            WebkitBackdropFilter: 'blur(16px) saturate(1.08)',
            boxShadow: 'var(--shadow), inset 0 1px 0 rgba(255,255,255,.5)',
          }}
        >
          {/* .map__title — SSOT: position:absolute; top:11px; left:12px; z-index:6;
              flex; align-items:center; gap:8px */}
          <div
            className="map__title absolute flex items-center z-[6]"
            style={{
              top: '11px',
              left: '12px',
              gap: '8px',
            }}
          >
            {/* .hicon — SSOT: 27px×27px; border-radius:8px; grid; place-items:center;
                background:var(--badge-bg); color:var(--badge-ink) */}
            <span
              className="hicon inline-grid place-items-center flex-none"
              style={{
                width: '27px',
                height: '27px',
                borderRadius: '8px',
                background: 'var(--badge-bg)',
                color: 'var(--badge-ink)',
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" style={{ width: '15px', height: '15px', display: 'block' }}>
                <path
                  d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinejoin="round"
                />
                <circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.9" />
              </svg>
            </span>
            {/* SSOT .map__title — font-family:var(--disp); font-size:13.5px; font-weight:800; color:var(--title) */}
            <span
              className="font-disp"
              style={{ fontWeight: 800, fontSize: '13.5px', color: 'var(--title)' }}
            >
              상담 여정
            </span>
          </div>
          <JourneyMap callId={callId} disableLiveData={false} />
        </div>

        {/* ── 우-하단: AI 응답 준비 ── */}
        {/* .chaincard — SSOT: height:100%; min-height:0; flex-direction:column;
            background:#F9F6EE; border:1px solid var(--card-bd); border-radius:18px;
            backdrop-filter:blur(16px) saturate(1.08); box-shadow:var(--shadow); overflow:hidden */}
        <div
          className="chaincard flex flex-col min-h-0 overflow-hidden"
          style={{
            height: '100%',
            background: '#F9F6EE',
            border: '1px solid var(--card-bd)',
            borderRadius: '18px',
            backdropFilter: 'blur(16px) saturate(1.08)',
            WebkitBackdropFilter: 'blur(16px) saturate(1.08)',
            boxShadow: 'var(--shadow)',
          }}
        >
          {/* .cc__head — SSOT: flex; align-items:center; gap:8px; padding:3px 14px */}
          <div
            className="cc__head flex items-center"
            style={{ gap: '8px', padding: '3px 14px' }}
          >
            {/* .hicon */}
            <span
              className="hicon inline-grid place-items-center flex-none"
              style={{
                width: '27px',
                height: '27px',
                borderRadius: '8px',
                background: 'var(--badge-bg)',
                color: 'var(--badge-ink)',
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" style={{ width: '15px', height: '15px', display: 'block' }}>
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
            </span>
            {/* .mk — SSOT: font-mono; 8.5px; font-weight:700; letter-spacing:.16em; color:var(--route);
                border:1.4px solid #C3D0EA; background:#fff; border-radius:6px; padding:2px 7px */}
            <span
              className="mk font-mono"
              style={{
                fontSize: '8.5px',
                fontWeight: 700,
                letterSpacing: '.16em',
                color: 'var(--route)',
                border: '1.4px solid #C3D0EA',
                background: '#fff',
                borderRadius: '6px',
                padding: '2px 7px',
                textTransform: 'uppercase',
              }}
            >
              AI응답준비
            </span>
            {/* h2 — SSOT: font-disp; 13.5px; font-weight:800; color:var(--title) */}
            <h2
              className="font-disp"
              style={{
                fontSize: '13.5px',
                fontWeight: 800,
                letterSpacing: '-.01em',
                margin: 0,
                color: 'var(--title)',
              }}
            >
              AI 응답 준비
            </h2>
            {/* .sub — SSOT: font-size:10.5px; color:var(--ink-faint) */}
            <span style={{ fontSize: '10.5px', color: 'var(--ink-faint)' }}>
              발화 분석 · DB 조회 · 컴플라이언스
            </span>
          </div>

          {/* .cc__body — SSOT: flex:1; flex-direction:column; gap:11px;
              padding:7px 8px 13px; min-height:0 */}
          <div
            className="cc__body flex flex-col flex-1 min-h-0"
            id="ccBody"
            style={{ gap: '11px', padding: '7px 8px 13px' }}
          >
            {/* .cc__cards — SSOT: flex:1; grid; grid-template-columns:repeat(3,1fr);
                gap:12px; min-height:0 */}
            <div
              className="cc__cards flex-1 grid min-h-0"
              style={{ gridTemplateColumns: 'repeat(3,1fr)', gap: '12px' }}
              data-testid="cc-cards"
            >

              {/* 카드① 고객발화분석 — SpeechAnalysis
                  .card — SSOT: position:relative; flex-direction:column; gap:9px; min-height:0;
                  border:1px solid var(--hair); border-radius:14px; background:rgba(255,255,255,.50);
                  padding:11px 12px; opacity:.5 (idle) */}
              <div
                className="card idle flex flex-col min-h-0 overflow-hidden"
                id="card-emo"
                data-testid="cc-card"
                style={{
                  position: 'relative',
                  gap: '9px',
                  border: '1px solid var(--hair)',
                  borderRadius: '14px',
                  background: 'rgba(255,255,255,.50)',
                  padding: '11px 12px',
                  opacity: 0.5,
                }}
              >
                {/* .card__h — SSOT: flex; align-items:center; gap:8px */}
                <div className="card__h flex items-center" style={{ gap: '8px' }}>
                  {/* .card__no — SSOT: 26px×26px; border-radius:8px; grid; place-items:center;
                      font-mono; 14px; font-weight:700; background:var(--badge-bg); color:#000 */}
                  <span
                    className="card__no font-mono inline-grid place-items-center flex-none"
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 700,
                      background: 'var(--badge-bg)',
                      color: '#000',
                    }}
                  >
                    1
                  </span>
                  {/* .card__t — SSOT: font-disp; 14px; font-weight:800; color:var(--title); line-height:1.1 */}
                  <span
                    className="card__t font-disp"
                    style={{ fontSize: '14px', fontWeight: 800, color: 'var(--title)', lineHeight: 1.1 }}
                  >
                    고객발화분석
                  </span>
                </div>
                <div className="card-scroll">
                  <SpeechAnalysis callId={callId} disableLiveData={false} />
                </div>
              </div>

              {/* 카드② DB 분석 — placeholder */}
              <div
                className="card idle flex flex-col min-h-0 overflow-hidden"
                id="card-db"
                data-testid="cc-card"
                style={{
                  position: 'relative',
                  gap: '9px',
                  border: '1px solid var(--hair)',
                  borderRadius: '14px',
                  background: 'rgba(255,255,255,.50)',
                  padding: '11px 12px',
                  opacity: 0.5,
                }}
              >
                <div className="card__h flex items-center" style={{ gap: '8px' }}>
                  <span
                    className="card__no font-mono inline-grid place-items-center flex-none"
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 700,
                      background: 'var(--badge-bg)',
                      color: '#000',
                    }}
                  >
                    2
                  </span>
                  <span
                    className="card__t font-disp"
                    style={{ fontSize: '14px', fontWeight: 800, color: 'var(--title)', lineHeight: 1.1 }}
                  >
                    DB 분석
                  </span>
                </div>
                <div className="card-scroll">
                  {/* 사용 데이터 섹션 */}
                  <div
                    className="flex items-center font-mono font-bold uppercase tracking-wider"
                    style={{ gap: '8px', fontSize: '10px', color: 'var(--ink-faint)' }}
                  >
                    <span>사용 데이터</span>
                    <span className="flex-1" style={{ borderTop: '1px solid var(--hair)' }} />
                  </div>
                  <div id="dbUse">
                    <p style={{ fontSize: '12px', color: 'var(--ink-faint)' }}>데이터 로딩 대기 중</p>
                  </div>
                  <div
                    className="flex items-center justify-center"
                    id="dbBridge"
                    style={{ padding: '4px 0', fontSize: '11px', color: 'var(--ink-faint)' }}
                  >
                    <span>▼</span>
                  </div>
                  {/* 데이터 분석 결과 섹션 */}
                  <div
                    className="flex items-center font-mono font-bold uppercase tracking-wider"
                    style={{ gap: '8px', fontSize: '10px', color: 'var(--ink-faint)' }}
                  >
                    <span>데이터 분석 결과</span>
                    <span className="flex-1" style={{ borderTop: '1px solid var(--hair)' }} />
                  </div>
                  <div id="dbRes">
                    <p style={{ fontSize: '12px', color: 'var(--ink-faint)' }}>분석 결과 대기 중</p>
                  </div>
                </div>
              </div>

              {/* 카드③ 컴플라이언스 체크 — CompliancePanel */}
              <div
                className="card idle flex flex-col min-h-0 overflow-hidden"
                id="card-strat"
                data-testid="cc-card"
                style={{
                  position: 'relative',
                  gap: '9px',
                  border: '1px solid var(--hair)',
                  borderRadius: '14px',
                  background: 'rgba(255,255,255,.50)',
                  padding: '11px 12px',
                  opacity: 0.5,
                }}
              >
                <div className="card__h flex items-center" style={{ gap: '8px' }}>
                  <span
                    className="card__no font-mono inline-grid place-items-center flex-none"
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 700,
                      background: 'var(--badge-bg)',
                      color: '#000',
                    }}
                  >
                    3
                  </span>
                  <span
                    className="card__t font-disp"
                    style={{ fontSize: '14px', fontWeight: 800, color: 'var(--title)', lineHeight: 1.1 }}
                  >
                    컴플라이언스 체크
                  </span>
                </div>
                <div className="card-scroll">
                  <CompliancePanel callId={callId} disableLiveData={false} />
                </div>
              </div>

            </div>{/* /cc__cards */}
          </div>{/* /cc__body */}
        </div>{/* /chaincard */}

      </div>{/* /rightcol */}

    </div>
  );
}
