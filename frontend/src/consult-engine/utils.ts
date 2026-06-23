// 시나리오 엔진 순수 함수 — SSOT docs/consult_redesigned-3.html에서 DOM-free 로직만 이식.
// 원본은 custSeq를 모듈 전역 mutable로 두지만, 여기선 인자로 받아 순수성을 유지한다.
import type { UAnalyzeEntry, ComplyEntry, FinalSeg } from '@/consult-engine/types';
import { UANALYZE } from '@/consult-engine/data/uanalyze';
import { DBDATA, DIAG } from '@/consult-engine/data/dbdata';
import { COMPLY, COMPLIANCE } from '@/consult-engine/data/comply';
import { AVAIL_STRAT, NEED_STRAT, EMO_STRAT } from '@/consult-engine/data/strategy';
import type { ComplianceState, FinalSegment } from '@/types/compliance';

// 다이어그램 노드 등장(260ms/노드) + 배너(420ms) 타이밍 상수 (SSOT 라인 1999).
export const DIAG_NODE = 260;
export const DIAG_BANNER = 420;

// 텍스트를 공백 정규화 후 n자로 자른다 (SSOT clip, 라인 1651).
export function clip(t: string, n: number): string {
  t = (t || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

// 다이어그램 전체 재생 시간 (SSOT diagDur, 라인 2000). reducedMotion이면 0.
export function diagDur(d: { nodes: unknown[] }, reducedMotion = false): number {
  if (reducedMotion) return 0;
  return d.nodes.length * DIAG_NODE + DIAG_BANNER;
}

// custSeq → 발화별 데이터 접근자 (SSOT uaFor/dbFor/procFor/cmpFor, 라인 1911–1914).
// custSeq는 엔진의 mutable ref이므로 인자로 받는다. 배열 끝으로 클램프.
export const uaFor = (custSeq: number) => UANALYZE[Math.min(custSeq, UANALYZE.length - 1)] || UANALYZE[0];
export const dbFor = (custSeq: number) => DBDATA[Math.min(custSeq, DBDATA.length - 1)] || DBDATA[0];
export const procFor = (custSeq: number) => DIAG[Math.min(custSeq, DIAG.length - 1)] || DIAG[0];
export const cmpFor = (custSeq: number) => COMPLY[Math.min(custSeq, COMPLY.length - 1)] || COMPLY[0];

// 감정/니즈/이용가능성 → 최적 대표 전략 최대 2개 (SSOT pickStrategies, 라인 1720–1728).
// 우선순위: 이용가능성(라우팅) > 니즈 > 감정. 중복 제거 후 앞에서 최대 2개. 비면 기본 0(관심 환기).
export function pickStrategies(ua: UAnalyzeEntry): number[] {
  const out: number[] = [];
  const push = (i: number | undefined) => {
    if (i != null && !out.includes(i)) out.push(i);
  };
  if (ua.obstacle) push(AVAIL_STRAT[ua.obstacle.dim]);
  if (ua.intent) push(NEED_STRAT[ua.intent.dim]);
  if (ua.psy) push(EMO_STRAT[ua.psy.dim]);
  if (out.length === 0) out.push(0); // 기본: 관심 환기
  return out.slice(0, 2);
}

// ── COMPLY(draftHtml/flags/final) → ComplianceState 변환 ──────────────────────
// 카드③ CompliancePanel은 ComplianceState(draft 평문 + violations 부분문자열)를 받는다.
// SSOT COMPLY는 draftHtml(<span class="risk">…</span> 포함)이므로 변환한다.

// draftHtml에서 위반 표현(span.risk 내용) 목록 추출.
export function extractViolations(draftHtml: string): string[] {
  const out: string[] = [];
  const re = /<span class="risk">(.*?)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(draftHtml)) !== null) out.push(m[1]);
  return out;
}

// draftHtml → 평문(태그 제거).
export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

// FinalSeg(t/del/ins/add) → FinalSegment(text/del/ins/added) 변환.
function toFinalSegment(seg: FinalSeg): FinalSegment {
  if ('t' in seg) return { text: seg.t };
  if ('del' in seg) return { del: seg.del, ins: seg.ins };
  return { ins: seg.ins, added: true };
}

// 컴플라이언스 단계별 ComplianceState 생성. step:
//   'draft'    → 가안만 (drafting)
//   N(0..3)    → 체크 N+1개까지 채움 (reviewing)
//   'final'    → 최종 diff + 통과 (approved)
export function complianceStateFor(
  callId: string,
  cmp: ComplyEntry,
  step: 'draft' | number | 'final',
): ComplianceState {
  const draft = stripHtml(cmp.draftHtml);
  const violations = extractViolations(cmp.draftHtml);
  if (step === 'draft') {
    return { callId, phase: 'drafting', draft, violations, checks: [], violatedPolicies: [], final: [] };
  }
  if (step === 'final') {
    return {
      callId,
      phase: 'approved',
      draft,
      violations,
      checks: COMPLIANCE.map((c, i) => ({ law: c.law, desc: c.desc, flagged: cmp.flags[i] })),
      violatedPolicies: COMPLIANCE.filter((_, i) => cmp.flags[i]).map((c) => c.law),
      final: cmp.final.map(toFinalSegment),
    };
  }
  // 숫자: step+1개 체크까지 채움 (나머지는 미검토 null)
  const upto = step;
  return {
    callId,
    phase: 'reviewing',
    draft,
    violations,
    checks: COMPLIANCE.map((c, i) => ({
      law: c.law,
      desc: c.desc,
      flagged: i <= upto ? cmp.flags[i] : null,
    })),
    violatedPolicies: [],
    final: [],
  };
}
