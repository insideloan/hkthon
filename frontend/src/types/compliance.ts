// Compliance wire types — mirror of the AppSync GraphQL contract.
//
// Contract status: the compliance loop producer is AGENT-010 (#18) and the
// onComplianceState subscription is not yet in graphql/schema.graphql (BACKEND).
// Until then this is hand-mirrored from the reference design
// (data/archive/consult_redesigned-2.html, 카드③ 컴플라이언스: 가안 → 4규제 → 최종 diff)
// expressed in AppSync GraphQL camelCase. Keep in sync when AGENT/BACKEND publish
// the real SDL — see CONVENTIONS.md §4 (no codegen yet).
import { z } from 'zod';

// State machine: drafting → reviewing → redacting → redrafting → approved.
export const COMPLIANCE_PHASES = [
  'drafting',
  'reviewing',
  'redacting',
  'redrafting',
  'approved',
] as const;
export type CompliancePhase = (typeof COMPLIANCE_PHASES)[number];

// One regulatory check (금소법/개인정보법/신용정보법/표현리스크 …).
// `flagged` true = 위반 발견 → 수정, false = 이상無, null = 아직 미검토.
export const ComplianceCheckSchema = z.object({
  law: z.string(),
  desc: z.string(),
  flagged: z.boolean().nullable().optional(),
});
export type ComplianceCheck = z.infer<typeof ComplianceCheckSchema>;

// Final-utterance diff segment:
//   { text }            — unchanged passage
//   { del, ins }        — replacement (원문 취소선 → 수정문 빨강)
//   { ins, added:true } — newly inserted safeguard sentence
export const FinalSegmentSchema = z.object({
  text: z.string().optional(),
  del: z.string().optional(),
  ins: z.string().optional(),
  added: z.boolean().optional(),
});
export type FinalSegment = z.infer<typeof FinalSegmentSchema>;

export const ComplianceStateSchema = z.object({
  callId: z.string(),
  // wire enum은 대문자(DRAFTING…) — 소문자 내부 표기로 정규화. 미설정 시 drafting.
  phase: z
    .preprocess(
      (v) => (typeof v === 'string' ? v.toLowerCase() : v),
      z.enum(COMPLIANCE_PHASES),
    )
    .default('drafting'),
  // 가안 발화 (위반 표현은 violations[] 의 substring 으로 강조).
  draft: z.string().nullable().optional().transform((v) => v ?? ''),
  // 가안에서 위반으로 표시할 표현들 (drafting/reviewing/redacting 단계에서 강조).
  violations: z.array(z.string()).nullable().optional().transform((v) => v ?? []),
  // 4규제 체크 결과 (reviewing 단계부터 채워짐).
  checks: z.array(ComplianceCheckSchema).nullable().optional().transform((v) => v ?? []),
  // 위반으로 판정된 정책 라벨 (redacting 단계 표시용).
  violatedPolicies: z.array(z.string()).nullable().optional().transform((v) => v ?? []),
  // 최종 발화 diff (redrafting/approved 단계).
  final: z.array(FinalSegmentSchema).nullable().optional().transform((v) => v ?? []),
});
export type ComplianceState = z.infer<typeof ComplianceStateSchema>;
