// Realtime wire types — mirror of the AppSync GraphQL subscription contract.
//
// Contract status: the real schema (graphql/schema.graphql, BACKEND-owned) is
// pending in BACKEND-009 (#28). Until then this is hand-mirrored from the SSOT
// in reference/API.md §2 (구독), expressed in AppSync GraphQL camelCase. The
// producers are AGENT (turn/index/speech/strategy/mot/callEnded); FRONTEND is a
// pure consumer here — it never computes churnRisk/emotion (see hk-implement §3.4
// + CHURN-RISK-LEXICON.md: AGENT owns the score, FRONTEND only displays it).
// Keep in sync when BACKEND publishes the real SDL — CONVENTIONS.md §4 (no codegen).
import { z } from 'zod';

// ── onTurn — 발화 스트리밍 (API.md §2.2) ──────────────────────────────────────
// speaker ∈ bot | customer | agent. Script mode broadcasts nextTurn's payload;
// live mode emits after STT finalization.
export const TURN_SPEAKERS = ['bot', 'customer', 'agent'] as const;
export type TurnSpeaker = (typeof TURN_SPEAKERS)[number];

export const TurnSchema = z.object({
  callId: z.string(),
  seq: z.number().int(),
  speaker: z.enum(TURN_SPEAKERS),
  text: z.string(),
  // 봇 발화 TTS mp3 presigned URL (라이브 모드, bot Turn만). 없으면 null/omitted.
  audioUrl: z.string().nullish(),
});
export type Turn = z.infer<typeof TurnSchema>;

// ── onIndexUpdate — 이탈위험도·감정 (API.md §2.3) ─────────────────────────────
// churnRisk: 0-100 정수, AGENT 산출 (SSOT: CHURN-RISK-LEXICON.md). FRONTEND 소비만.
// emotion: 한국어 자연어 레이블 ("불안" | "관심" | "중립" | "저항" 등) — 자유 문자열.
export const IndexUpdateSchema = z.object({
  callId: z.string(),
  churnRisk: z.number().int().min(0).max(100),
  emotion: z.string(),
});
export type IndexUpdate = z.infer<typeof IndexUpdateSchema>;

// ── onSpeechAnalysis — 발화 분석 토큰 (API.md §2.4) ───────────────────────────
// polarity ∈ PRO(초록) | CONS(빨강) | NEUTRAL. reason = 1줄 근거 (한국어).
export const TOKEN_POLARITIES = ['PRO', 'CONS', 'NEUTRAL'] as const;
export type TokenPolarity = (typeof TOKEN_POLARITIES)[number];

export const SpeechTokenSchema = z.object({
  text: z.string(),
  polarity: z.enum(TOKEN_POLARITIES),
  reason: z.string(),
});
export type SpeechToken = z.infer<typeof SpeechTokenSchema>;

export const SpeechAnalysisSchema = z.object({
  callId: z.string(),
  turnSeq: z.number().int(),
  tokens: z.array(SpeechTokenSchema).default([]),
});
export type SpeechAnalysis = z.infer<typeof SpeechAnalysisSchema>;

// ── onStrategyUpdate — 상담 전략 (API.md §2.5) ────────────────────────────────
// headline = 큰 텍스트(상단), data 칩 = 보조(하단). Next action 카드는 제거됨.
export const StrategyDataSchema = z.object({
  live: z.object({ lastIntent: z.string() }).partial().optional(),
  static: z.object({ creditScore: z.number().int() }).partial().optional(),
});
export type StrategyData = z.infer<typeof StrategyDataSchema>;

export const StrategyUpdateSchema = z.object({
  callId: z.string(),
  turnSeq: z.number().int(),
  headline: z.string(),
  rationale: z.string(),
  data: StrategyDataSchema.optional(),
});
export type StrategyUpdate = z.infer<typeof StrategyUpdateSchema>;

// ── onMotDetected — MOT 마커 (API.md §2.7) ────────────────────────────────────
// type RISK: churnAfter-churnBefore ≥ +12 또는 churnAfter ≥ 60.
// type CONVERSION: TRANSFER_INTENT/BUYING_INTENT 매칭 턴.
export const MOT_TYPES = ['RISK', 'CONVERSION'] as const;
export type MotType = (typeof MOT_TYPES)[number];

export const MOT_OUTCOMES = ['defended', 'converted', 'lost'] as const;
export type MotOutcome = (typeof MOT_OUTCOMES)[number];

export const MotStrategySchema = z.object({
  tactic: z.string().nullable().optional(),
  headline: z.string().nullable().optional(),
});

export const MotDetectedSchema = z.object({
  callId: z.string(),
  seq: z.number().int(),
  type: z.enum(MOT_TYPES),
  turnSeq: z.number().int(),
  churnBefore: z.number().int(),
  churnAfter: z.number().int(),
  triggers: z.array(z.string()).default([]),
  strategy: MotStrategySchema.nullable().optional(),
  outcome: z.enum(MOT_OUTCOMES).nullable().optional(),
  narrative: z.string().nullable().optional(),
});
export type MotDetected = z.infer<typeof MotDetectedSchema>;

// ── onCallEnded — 통화 종료 (API.md §2.8) ─────────────────────────────────────
// resultType ∈ 한도조회_상담원연결 | 가입승인 | 거절. endedAt = ISO-8601 UTC.
export const CALL_RESULT_TYPES = [
  '한도조회_상담원연결',
  '가입승인',
  '거절',
] as const;
export type CallResultType = (typeof CALL_RESULT_TYPES)[number];

export const CallEndedSchema = z.object({
  callId: z.string(),
  resultType: z.enum(CALL_RESULT_TYPES),
  endedAt: z.string(),
});
export type CallEnded = z.infer<typeof CallEndedSchema>;
