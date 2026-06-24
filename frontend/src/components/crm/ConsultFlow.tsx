// ConsultFlow — 상담 흐름 요약 (.sum-flow) + MOT 마커 (FRONTEND-010 / #39).
// SSOT: docs/consult_redesigned-3.html lines 1161-1165 (#view-summary > .sum-flow).
// MOT는 별도 보드/카드/패널 없이 각 단계 li에 마커(배지)로만 표시.
// type RISK → hazard 계열, outcome defended / type CONVERSION → go 계열 체크.
// BACKEND-007 미완 → fetchMots mock으로 동작. CompliancePanel 패턴 동일.
'use client';

import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { fetchMots } from '@/lib/appsync';
import type { MotDetected } from '@/types/realtime';

// ── SSOT 4단계 (consult_redesigned-3.html 1162-1165) ─────────────────────────
// 순서 고정. stageKey는 MOT 매핑 키 (stage 파라미터 없을 때 narrative/trigger로 추론).
export const FLOW_STEPS = [
  {
    stage: '신뢰 쌓기',
    tx: '대출 거부·경계 → 비교 프레임 전환, 통화 유지',
  },
  {
    stage: '우려 풀기',
    tx: '조건 불신·가격 저항 → 실측 금리(자담 10%대) 안내·검증 가능성 제시로 신뢰 회복',
  },
  {
    stage: '담보 오해',
    tx: '차량담보 거부감 최고조 → 운행 가능 안심 + 자율성 부여',
  },
  {
    stage: '전환 맺기',
    tx: '"신청 말고 비교만" 수용 → AI 접수 전환 성공',
  },
] as const;

export type FlowStage = (typeof FLOW_STEPS)[number]['stage'];

// ── MOT → 단계 매핑 ───────────────────────────────────────────────────────────
// BACKEND-007이 stage 필드를 아직 제공하지 않으므로, narrative/triggers 텍스트에서
// 단계 키워드를 추론한다. 키워드는 SSOT stage 라벨과 일치시킨다.
const STAGE_KEYWORDS: Record<FlowStage, string[]> = {
  '신뢰 쌓기': ['신뢰', '신뢰확보', '신뢰 쌓기', 'trust'],
  '우려 풀기': ['우려', '우려 풀기', '가격 저항', '불신', '금리'],
  '담보 오해': ['담보', '담보 오해', '차량담보', '오해', 'security'],
  '전환 맺기': ['전환', '전환 맺기', '연결', '맺기', 'conversion', 'converted'],
};

/**
 * MotDetected 1개를 FLOW_STEPS 중 하나에 매핑한다.
 * MOT 오브젝트에 `stage` 필드가 있으면 우선 사용(미래 BACKEND-007 대응).
 * 없으면 narrative + triggers 텍스트에서 키워드 탐색.
 * 매핑 전략: 긴 키워드(더 구체적)가 먼저 매칭되도록 키워드를 길이 내림차순 정렬.
 * 아무 단계에도 매핑 안 되면 null.
 */
function resolveStage(mot: MotDetected & { stage?: string }): FlowStage | null {
  // 미래 백엔드 stage 필드 대응
  if (mot.stage) {
    const direct = FLOW_STEPS.find((s) => s.stage === mot.stage);
    if (direct) return direct.stage;
  }
  const text = [mot.narrative ?? '', ...(mot.triggers ?? [])].join(' ');

  // Build a flat list of (stage, keyword) pairs sorted by keyword length descending
  // so longer (more specific) keywords take priority over shorter overlapping ones.
  type KwEntry = { stage: FlowStage; kw: string };
  const entries: KwEntry[] = [];
  for (const [stage, kws] of Object.entries(STAGE_KEYWORDS) as [FlowStage, string[]][]) {
    for (const kw of kws) entries.push({ stage, kw });
  }
  entries.sort((a, b) => b.kw.length - a.kw.length);

  for (const { stage, kw } of entries) {
    if (text.includes(kw)) return stage;
  }
  return null;
}

// ── 마커 스타일 ───────────────────────────────────────────────────────────────
// defended outcome 또는 CONVERSION → go(초록 체크).
// RISK (not defended) → hazard(주황 경고).
function markerVariant(mot: MotDetected): 'defended' | 'hazard' {
  if (mot.outcome === 'defended' || mot.type === 'CONVERSION') return 'defended';
  return 'hazard';
}

// ── types ─────────────────────────────────────────────────────────────────────
type StepMots = Map<FlowStage, MotDetected[]>;

function buildStepMots(mots: MotDetected[]): StepMots {
  const map: StepMots = new Map();
  for (const mot of mots) {
    const stage = resolveStage(mot as MotDetected & { stage?: string });
    if (!stage) continue;
    const existing = map.get(stage) ?? [];
    map.set(stage, [...existing, mot]);
  }
  return map;
}

// ── MOT 마커 배지 ─────────────────────────────────────────────────────────────
function MotMarker({ mot }: { mot: MotDetected }) {
  const variant = markerVariant(mot);
  const isDefended = variant === 'defended';
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold',
        isDefended
          ? 'bg-go/10 text-go'
          : 'bg-hazard/10 text-hazard-ink',
      )}
      data-testid="mot-marker"
      data-mot-type={mot.type}
      data-mot-outcome={mot.outcome ?? ''}
      aria-label={isDefended ? 'MOT 방어 완료' : 'MOT 이탈 위험'}
    >
      <span aria-hidden>{isDefended ? '✓' : '⚠'}</span>
      {isDefended ? '방어' : '위험'}
    </span>
  );
}

// ── ConsultFlow props ─────────────────────────────────────────────────────────
type ConsultFlowProps = {
  callId: string;
  /** Tests / offline: inject mots directly and skip the live query. */
  initialMots?: MotDetected[];
  disableLiveData?: boolean;
};

// ── ConsultFlow ───────────────────────────────────────────────────────────────
export function ConsultFlow({
  callId,
  initialMots,
  disableLiveData = false,
}: ConsultFlowProps) {
  const [mots, setMots] = useState<MotDetected[]>(initialMots ?? []);

  useEffect(() => {
    if (disableLiveData) return;
    let cancelled = false;
    fetchMots(callId)
      .then((data) => {
        if (!cancelled) setMots(data);
      })
      .catch((err) => console.error('mots 쿼리 오류', err));
    return () => {
      cancelled = true;
    };
  }, [callId, disableLiveData]);

  const stepMots = buildStepMots(mots);

  return (
    <ol
      className="m-0 flex list-none flex-col gap-[9px] p-0"
      data-testid="consult-flow"
      aria-label="상담 흐름 요약"
    >
      {FLOW_STEPS.map((step) => {
        const stageMots = stepMots.get(step.stage) ?? [];
        return (
          <li
            key={step.stage}
            className="flex gap-[10px] items-start"
            data-testid={`flow-step-${step.stage}`}
          >
            {/* sf-stage */}
            <span
              className="flex-none w-[78px] font-disp text-xs font-extrabold text-[var(--route)] bg-[var(--badge-bg)] rounded-[8px] px-[8px] py-[5px] text-center"
              data-testid="sf-stage"
            >
              {step.stage}
            </span>
            {/* sf-tx + MOT markers */}
            <span className="text-[12.5px] leading-[1.5] text-ink-dim pt-[2px] flex-1 min-w-0">
              {step.tx}
              {stageMots.length > 0 && (
                <span className="ml-1.5 inline-flex flex-wrap gap-1">
                  {stageMots.map((mot, i) => (
                    <MotMarker key={`${mot.seq}-${i}`} mot={mot} />
                  ))}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
