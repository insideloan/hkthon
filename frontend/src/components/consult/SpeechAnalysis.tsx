// SpeechAnalysis — 카드① 고객발화분석 (FRONTEND-004/005/006).
// 실시간: onSpeechAnalysis + onStrategyUpdate + onIndexUpdate AppSync 구독.
// SSOT: docs/consult_redesigned-3.html 카드① (#card-emo).
//
// 디자인 원칙 (SSOT 재정렬 2026-06-22):
//   · 키워드(.kw): 폰트 강조(bold·1.18em)만 — 색상·배경 없음.
//   · 극성(polarity)을 색상에 매핑하지 않음(k-go/k-risk 미사용).
//   · 턴 단위 위험/방어 신호: flag 배지(.flag--risk/.flag--def).
//   · reason: 키워드 아코디언 없음 — 선택된 전략 카드 .slead로 노출.
//   · 전략: 카드①내 STRAT20 파이프라인 (20 .scard → 규칙 선택 .scard.sel).
//   · 별도 StrategyPanel 없음, 카드② DB분석 불변.
//   · FRONTEND-012: emotion → 발화분류 bins의 감정(EMOTION) bin 표시.
'use client';

import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { subscribeSpeechAnalysis, subscribeStrategyUpdate } from '@/lib/appsync';
import * as appsyncMod from '@/lib/appsync';
import type {
  SpeechAnalysis as SpeechAnalysisData,
  SpeechToken,
  StrategyUpdate,
} from '@/types/realtime';
import { useCard1Store } from '@/stores/card1Store';
import { CATS } from '@/consult-engine/data/strategy';

// ── STRAT20 (SSOT docs/consult_redesigned-3.html) ──────────────────────────
const STRAT20: ReadonlyArray<{ name: string; lead: string }> = [
  { name: '관심 환기 전략',          lead: '개인 관련성 높은 한 문장으로 통화 지속 이유를 만든다' },
  { name: '신뢰 확보 전략',          lead: '통화 출처·연락 사유·공식 절차를 먼저 설명해 경계를 낮춘다' },
  { name: '상품 확인 전략',          lead: '상품의 목적과 구조를 먼저 정리한다' },
  { name: '의심 해소 전략',          lead: '과장 없이 확인 전/후 정보를 분리해 설명한다' },
  { name: '공감 후 전환 전략',       lead: '우려를 먼저 인정한 뒤 부담 낮은 다음 행동으로 연결한다' },
  { name: '불안 완화 전략',          lead: '신용·개인정보·승인 불안에 안전 기준과 절차를 설명한다' },
  { name: '부담 완화 전략',          lead: '월 납입·기간·대환 관점으로 상환 부담을 설명한다' },
  { name: '한도 탐색 전략',          lead: '확정 표현 없이 가능 한도 확인 절차로 유도한다' },
  { name: '금리 비교 전략',          lead: '기존 조건 대비 비교 기준을 제시한다' },
  { name: '대환 제안 전략',          lead: '갈아타기 가능성과 절감 효과를 확인시킨다' },
  { name: '추가 자금 전략',          lead: '필요 금액·사용 시점·상환 가능성을 확인한다' },
  { name: '승인 가능성 확인 전략',   lead: '고객 조건으로 진행 가능한지 기본 요건을 확인한다' },
  { name: '자격 조건 확인 전략',     lead: '명의·연식·소득 등 필수 조건을 점검한다' },
  { name: '절차 간소화 전략',        lead: '단계와 소요 시간을 짧게 정리한다' },
  { name: '상환 조건 설명 전략',     lead: '상환 방식·기간·중도상환 등 이용 후 조건을 설명한다' },
  { name: '비교 검토 지원 전략',     lead: '금리·월 납입·총 상환액 기준으로 비교를 돕는다' },
  { name: '긴급 실행 전략',          lead: '가능 시점과 필수 확인사항을 우선 안내한다' },
  { name: '재통화 예약 전략',        lead: '후속 콜 기회로 전환한다' },
  { name: '거절 존중 전략',          lead: '추가 설득을 멈추고 종료·수신거부를 안내한다' },
  { name: '상담원 인계·컴플라이언스 보호 전략', lead: '안전 문구로 전환하거나 사람에게 넘긴다' },
  { name: 'AI 접수 전환 전략',       lead: '무서류·신속 니즈를 AI 접수·본 심사로 전환한다' },
];

// ── turn-level signal: CONS token → risk, PRO token → def (risk wins) ──────
type TurnSignal = 'risk' | 'def' | null;

function deriveTurnSignal(tokens: SpeechToken[]): TurnSignal {
  let signal: TurnSignal = null;
  for (const tok of tokens) {
    if (tok.polarity === 'CONS') return 'risk'; // risk has priority
    if (tok.polarity === 'PRO') signal = 'def';
  }
  return signal;
}

// ── Token renderer: keyword = font emphasis only (no color, no background) ──
function TokenBubble({ tokens }: { tokens: SpeechToken[] }) {
  return (
    <span className="text-[11px] leading-relaxed">
      {tokens.map((tok, i) => (
        <span
          key={i}
          className={clsx(
            // All tokens are plain ink color — polarity NOT mapped to color.
            'text-ink',
            // Keywords get font emphasis only (kw style from SSOT).
            tok.polarity !== 'NEUTRAL' && 'kw font-extrabold text-[1.18em] tracking-tight',
          )}
          data-testid={tok.polarity !== 'NEUTRAL' ? 'sa-kw' : undefined}
        >
          {tok.text}
          {i < tokens.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  );
}

// ── Per-turn row: bubble + optional flag badge ───────────────────────────────
function TurnRow({ analysis }: { analysis: SpeechAnalysisData }) {
  const signal = deriveTurnSignal(analysis.tokens);
  return (
    <div
      className="flex flex-col gap-1"
      data-testid="sa-turn"
      data-turn-seq={analysis.turnSeq}
    >
      <div className="max-w-[88%] self-start rounded-[9px] border border-[var(--hair)] bg-[var(--paper)] px-[9px] py-[6px]">
        <TokenBubble tokens={analysis.tokens} />
      </div>
      {signal === 'risk' && (
        <span
          className="flag flag--risk inline-flex items-center gap-1.5 self-start rounded-full border border-danger/30 bg-danger/10 px-[9px] py-[3px] font-mono text-[10px] font-bold tracking-[.02em] text-danger"
          data-testid="sa-flag-risk"
        >
          위험 신호
        </span>
      )}
      {signal === 'def' && (
        <span
          className="flag flag--def inline-flex items-center gap-1.5 self-start rounded-full border border-go/30 bg-go/10 px-[9px] py-[3px] font-mono text-[10px] font-bold tracking-[.02em] text-go"
          data-testid="sa-flag-def"
        >
          방어 신호
        </span>
      )}
    </div>
  );
}

// ── STRAT20 grid: 21 cards (20종 + AI 접수 전환), selected one enlarged (scard sel) ──
// reason from onSpeechAnalysis is surfaced as the selected card's lead text
// (SSOT: .stratg.resolved .scard.sel .slead)
function StratGrid({
  selectedIndex,
  overrideLead,
}: {
  selectedIndex: number | null;
  overrideLead?: string;
}) {
  const resolved = selectedIndex !== null;
  return (
    <div
      className={clsx(
        resolved ? 'resolved flex flex-col gap-2' : 'grid grid-cols-4 gap-[5px]',
      )}
      data-testid="sa-stratg"
      data-resolved={resolved ? 'true' : 'false'}
    >
      {STRAT20.map((s, idx) => {
        const isSel = resolved && idx === selectedIndex;
        return (
          <div
            key={idx}
            className={clsx(
              'scard',
              'relative flex flex-col gap-[2px] rounded-2xl border border-[var(--hair)] bg-[var(--card)] p-[6px]',
              // When resolved, hide all non-selected cards; show selected enlarged
              resolved && !isSel && 'hidden',
              resolved && isSel && 'flex-1 overflow-hidden glass-card p-4',
              isSel && 'sel',
            )}
            data-testid={isSel ? 'sa-scard-sel' : 'sa-scard'}
            data-i={idx}
          >
            <span
              className={clsx(
                'sno font-mono font-bold',
                !isSel && 'text-[7px] text-ink-faint',
                isSel && 'text-[12.5px] font-extrabold leading-[1.3] text-ink',
              )}
            >
              {String(idx + 1).padStart(2, '0')}
            </span>
            <span
              className={clsx(
                'stx font-extrabold leading-tight tracking-[-0.02em]',
                !isSel && 'text-[11.5px] text-ink',
                isSel && 'text-[12.5px] font-extrabold leading-[1.3] text-ink',
              )}
              data-testid={isSel ? 'sa-stx' : undefined}
            >
              {s.name}
            </span>
            <span
              className={clsx(
                'slead font-semibold leading-[1.2]',
                !isSel && 'text-[7.5px] text-ink-dim',
                isSel &&
                  'mt-[3px] line-clamp-4 text-[12.5px] font-semibold leading-[1.3] text-ink-dim',
              )}
              data-testid={isSel ? 'sa-slead' : undefined}
            >
              {/* If reason is provided via onSpeechAnalysis, use it; else STRAT20 lead */}
              {isSel && overrideLead ? overrideLead : s.lead}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── EmoBins — SSOT #emoBins 발화분류 3칸 ──────────────────────────────────────
// FRONTEND-012: emotion → 감정(EMOTION) bin 표시.
// 3개 카테고리 (SSOT 변경 불가):
//   psy     → 감정 / EMOTION
//   intent  → 니즈 / NEEDS
//   obstacle→ 이용가능성 / AVAILABILITY
const EMO_CATS = [
  { key: 'psy',      label: '감정',     en: 'EMOTION' },
  { key: 'intent',   label: '니즈',     en: 'NEEDS' },
  { key: 'obstacle', label: '이용가능성', en: 'AVAILABILITY' },
] as const;

type EmoBinsCatKey = typeof EMO_CATS[number]['key'];

function EmoBins({ emotion }: { emotion: string | null }) {
  return (
    <div
      className="grid grid-cols-3 gap-2"
      id="emoBins"
      data-testid="emo-bins"
    >
      {EMO_CATS.map(({ key, label, en }) => (
        <div
          key={key}
          className={clsx(
            'flex flex-col gap-1 rounded-xl border border-[var(--hair)] bg-[var(--card)] p-2',
            `bin bin--${key}`,
          )}
          data-cat={key}
          data-testid={`emo-bin-${en.toLowerCase()}`}
        >
          <div className="bin__h flex items-baseline gap-1">
            <b className="font-disp text-[11px] font-bold text-ink">{label}</b>
          </div>
          <div
            className="min-h-[28px]"
            id={`slot-${key}`}
            data-testid={`emo-slot-${en.toLowerCase()}`}
          >
            {/* EMOTION bin: render emotion label as orb when available */}
            {key === 'psy' && emotion && (
              <div
                className={clsx(
                  'orb inline-flex items-center rounded-full px-2 py-0.5',
                  'bg-[var(--badge-bg)] text-[var(--badge-ink)]',
                )}
                data-testid="emo-emotion-orb"
              >
                <span className="otag font-mono text-[10px] font-bold">{emotion}</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── engineMode: SSOT 충실 카드① (bins + solveArrow + stratg) ──────────────────
// 시나리오 엔진(useConsultEngine)이 card1Store에 단계적으로 기록 → SSOT 마크업 그대로.
const ENGINE_CATS = [
  { key: 'psy', ...CATS.psy },
  { key: 'intent', ...CATS.intent },
  { key: 'obstacle', ...CATS.obstacle },
] as const;

// 발화분류 키워드 띄어쓰기 사전 — 붙어있는 합성 키워드를 자연스러운 단어로 분리한다.
// (주로 이용가능성(obstacle) 칸의 긴 키워드. 예: 월납입확인후판단 → 월 납입 확인 후 판단)
const KEYWORD_SPACING: Record<string, string> = {
  대출거부: '대출 거부',
  금리확인후판단: '금리 확인 후 판단',
  월납입확인후판단: '월 납입 확인 후 판단',
  기존대출비교후판단: '기존 대출 비교 후 판단',
  설명추가필요: '설명 추가 필요',
  상품부적합: '상품 부적합',
  상담원연결필요: '상담원 연결 필요',
};

// 띄어쓰기된 문장을 단어 단위로 두 줄로 나눈다. 줄당 글자 수가 균형잡히도록
// (공백 제외) 누적 글자 수가 절반에 가장 가까운 단어 경계에서 끊는다.
// 예: "월 납입 확인 후 판단" → "월 납입"(3자) / "확인 후 판단"(5자).
function splitWordsBalanced(spaced: string): [string, string] | null {
  const words = spaced.split(' ');
  if (words.length < 2) return null;
  const total = words.reduce((n, w) => n + w.length, 0);
  let acc = 0;
  let best = { idx: 1, diff: Infinity };
  for (let i = 1; i < words.length; i++) {
    acc += words[i - 1].length;
    const diff = Math.abs(acc - total / 2);
    if (diff < best.diff) best = { idx: i, diff };
  }
  return [words.slice(0, best.idx).join(' '), words.slice(best.idx).join(' ')];
}

// 발화분류 칸 텍스트 렌더. 띄어쓰기 사전에 있으면 단어 단위로 두 줄(가운데 정렬),
// 없고 5글자 초과면 글자 가운데에서 두 줄, 5글자 이하는 한 줄.
export function OtagText({ text }: { text: string }) {
  const spaced = KEYWORD_SPACING[text];
  if (spaced) {
    const lines = splitWordsBalanced(spaced);
    if (lines) {
      return (
        <>
          {lines[0]}
          <br />
          {lines[1]}
        </>
      );
    }
    return <>{spaced}</>;
  }
  if (text.length <= 5) return <>{text}</>;
  const mid = Math.ceil(text.length / 2);
  return (
    <>
      {text.slice(0, mid)}
      <br />
      {text.slice(mid)}
    </>
  );
}

function EngineCard1() {
  const { psy, intent, obstacle, stratPhase, picked } = useCard1Store();
  const orbByKey = { psy, intent, obstacle } as const;
  const resolved = stratPhase === 'resolved';

  return (
    // SSOT docs/consult_redesigned-3.html #card-emo .card-scroll (lines 1080–1086):
    // 발화분류 → bins → solvearrow(▼) → 대표 전략 20 → stratg.
    <div className="card-scroll" role="region" aria-label="고객발화분석" data-testid="speech-analysis">
      {/* 첫 섹션 라벨 제거됨 */}

      {/* orb bins — 감정/니즈/이용가능성 */}
      <div className="bins" id="emoBins">
        {ENGINE_CATS.map(({ key, label }) => {
          const orb = orbByKey[key as 'psy' | 'intent' | 'obstacle'];
          return (
            <div className={clsx('bin', key)} key={key} data-cat={key}>
              <div className="bin__h"><b>{label}</b></div>
              <div className="bin__slot" id={`slot-${key}`}>
                {orb && (
                  <div className={clsx('orb', key, 'drop', orb.tone && 'eased')} data-testid={`orb-${key}`}>
                    <span className="otag"><OtagText text={orb.dim} /></span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 발화분류 → 대표 전략 전이 화살표(▼) — PPTX 레이아웃 7번 */}
      <div className="solvearrow on" id="solveArrow" aria-hidden="true"><span className="dn">▼</span></div>

      <div className="cseclbl cseclbl--sec"><span>전략 선택 (20종)</span><span className="ln" /></div>

      {/* 전략 그리드 20장 → swiping → resolved */}
      <div
        className={clsx('stratg', stratPhase === 'swiping' && 'swiping', resolved && 'resolved', resolved && picked.length === 1 && 'one')}
        id="stratGrid"
        data-testid="strat-grid"
        data-phase={stratPhase}
      >
        <div className="strat-track">
          {STRAT20.map((s, idx) => {
            const isSel = resolved && picked.includes(idx);
            return (
              <div className={clsx('scard', isSel && 'sel')} key={idx} data-i={idx} data-testid={isSel ? 'strat-sel' : undefined}>
                <span className="sno">{String(idx + 1).padStart(2, '0')}</span>
                <span className="stx">{s.name}</span>
                <span className="slead">{s.lead}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Component state ───────────────────────────────────────────────────────────
type TurnAnalysis = {
  turnSeq: number;
  tokens: SpeechToken[];
};

type SpeechAnalysisState = {
  turns: TurnAnalysis[];
  selectedStrategyIndex: number | null;
  strategyLead: string | undefined;
};

// ── Props (mock-first: initialState + disableLiveData mirrors CompliancePanel) ─
export type SpeechAnalysisProps = {
  callId: string;
  /** Seed state for tests/Storybook — skips live AppSync subscription. */
  initialState?: SpeechAnalysisState;
  /** FRONTEND-012: seed initial emotion for tests/Storybook. */
  initialEmotion?: string | null;
  disableLiveData?: boolean;
  /** 시나리오 엔진 모드: card1Store 구독, SSOT 충실 마크업(bins+stratg) 렌더. */
  engineMode?: boolean;
};

export function SpeechAnalysis(props: SpeechAnalysisProps) {
  // 엔진 모드: AppSync 구독 없이 card1Store 기반 SSOT 마크업.
  // (래퍼로 분기해 아래 LiveSpeechAnalysis의 hooks 규칙을 지킨다.)
  if (props.engineMode) return <EngineCard1 />;
  return <LiveSpeechAnalysis {...props} />;
}

function LiveSpeechAnalysis({
  callId,
  initialState,
  initialEmotion = null,
  disableLiveData = false,
}: SpeechAnalysisProps) {
  const [turns, setTurns] = useState<TurnAnalysis[]>(initialState?.turns ?? []);
  const [selectedStratIdx, setSelectedStratIdx] = useState<number | null>(
    initialState?.selectedStrategyIndex ?? null,
  );
  const [strategyLead, setStrategyLead] = useState<string | undefined>(
    initialState?.strategyLead,
  );
  // FRONTEND-012: emotion → 감정 bin
  const [emotion, setEmotion] = useState<string | null>(initialEmotion);

  // onIndexUpdate subscription — FRONTEND-012: update emotion bin
  useEffect(() => {
    if (disableLiveData) return;
    // Guard: partial test mocks may omit subscribeIndexUpdate — check existence
    // before access to avoid Vitest mock proxy throw on undefined named exports.
    if (!('subscribeIndexUpdate' in appsyncMod)) return;
    const sub = appsyncMod.subscribeIndexUpdate;
    if (typeof sub !== 'function') return;
    const unsub = sub(
      callId,
      (index) => { if (index.emotion != null) setEmotion(index.emotion); },
      (err) => console.error('onIndexUpdate(SpeechAnalysis) 구독 오류', err),
    );
    return unsub;
  }, [callId, disableLiveData]);

  // onSpeechAnalysis subscription
  useEffect(() => {
    if (disableLiveData) return;
    const unsub = subscribeSpeechAnalysis(
      callId,
      (analysis: SpeechAnalysisData) => {
        setTurns((prev) => {
          // Replace existing turn for this seq, or append
          const idx = prev.findIndex((t) => t.turnSeq === analysis.turnSeq);
          const next = { turnSeq: analysis.turnSeq, tokens: analysis.tokens };
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = next;
            return updated;
          }
          return [...prev, next];
        });
        // Surface the last token's reason in the selected strategy lead
        const lastReason = analysis.tokens.at(-1)?.reason;
        if (lastReason) setStrategyLead(lastReason);
      },
      (err) => console.error('onSpeechAnalysis 구독 오류', err),
    );
    return unsub;
  }, [callId, disableLiveData]);

  // onStrategyUpdate subscription
  useEffect(() => {
    if (disableLiveData) return;
    const unsub = subscribeStrategyUpdate(
      callId,
      (strategy: StrategyUpdate) => {
        // Find which STRAT20 card matches by headline
        const matchIdx = STRAT20.findIndex((s) => s.name === strategy.strategyHeadline);
        setSelectedStratIdx(matchIdx >= 0 ? matchIdx : null);
        setStrategyLead(strategy.rationale || undefined);
      },
      (err) => console.error('onStrategyUpdate 구독 오류', err),
    );
    return unsub;
  }, [callId, disableLiveData]);

  return (
    <section
      className="flex flex-col gap-2"
      aria-label="고객발화분석"
      data-testid="speech-analysis"
    >
      {/* 발화분류 section label */}
      <div className="mb-1 font-mono text-[10px] font-bold uppercase tracking-wider text-ink-faint">
        분석 결과
      </div>

      {/* SSOT #emoBins — 감정/니즈/이용가능성 bins; EMOTION bin shows callStore emotion */}
      <EmoBins emotion={emotion} />

      {/* Transcript turns with keyword bubbles + flag badges */}
      <div className="flex flex-col gap-2" data-testid="sa-turns">
        {turns.length === 0 ? (
          <p className="text-xs text-ink-faint">발화 분석 대기 중</p>
        ) : (
          turns.map((turn) => (
            <TurnRow
              key={turn.turnSeq}
              analysis={{ callId, turnSeq: turn.turnSeq, tokens: turn.tokens }}
            />
          ))
        )}
      </div>

      {/* Arrow divider between transcript and strategy section */}
      <div className="flex items-center justify-center gap-1.5 py-1 text-[11px] text-ink-faint">
        <span>▼</span>
      </div>

      {/* 대표 전략 20 section label */}
      <div className="mb-1 font-mono text-[10px] font-bold uppercase tracking-wider text-ink-faint">
        전략 선택 (20종)
      </div>

      {/* STRAT20 pipeline — resolved shows enlarged selected card */}
      <StratGrid selectedIndex={selectedStratIdx} overrideLead={strategyLead} />
    </section>
  );
}
