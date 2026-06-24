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
// dbChips/dbNodes: 체험 시나리오 preset의 카드② DB분석. 선택(없으면 미표시).
export const DbNodeSchema = z.object({
  label: z.string(),
  val: z.string().nullable().optional(),
  tone: z.string().nullable().optional(),
});
export type DbNode = z.infer<typeof DbNodeSchema>;

export const IndexUpdateSchema = z.object({
  callId: z.string(),
  // churnRisk/emotion은 선택 — DB분석만 단독 발화될 수 있어 nullable로 완화.
  churnRisk: z.number().int().min(0).max(100).nullable().optional(),
  emotion: z.string().nullable().optional(),
  dbChips: z.array(z.string()).nullable().optional(),
  dbNodes: z.array(DbNodeSchema).nullable().optional(),
});
export type IndexUpdate = z.infer<typeof IndexUpdateSchema>;

// ── onSpeechAnalysis — 발화 분석 토큰 (API.md §2.4) ───────────────────────────
// polarity ∈ PRO | CONS | NEUTRAL. reason = 1줄 근거 (한국어).
// ⚠️ SSOT-3 wire contract (BACKEND #28 canonical / graphql Polarity 는 nullable):
//   백엔드는 NEUTRAL/"" 를 wire 에서 null 로 정규화해 보낸다 (turn.py _ALLOWED_POLARITY).
//   따라서 polarity 는 'PRO'|'CONS'|null(or 누락) 로 도착한다 — null 을 거부하면
//   ZodError 가 onSpeechAnalysis 구독 전체 파싱을 죽여 발화분석 카드가 멈춘다.
//   여기서 null/누락 → 'NEUTRAL' 로 정규화해 downstream(=== 'NEUTRAL') 분기를 보존한다.
export const TOKEN_POLARITIES = ['PRO', 'CONS', 'NEUTRAL'] as const;
export type TokenPolarity = (typeof TOKEN_POLARITIES)[number];

export const SpeechTokenSchema = z.object({
  text: z.string(),
  polarity: z
    .enum(TOKEN_POLARITIES)
    .nullish()
    .transform((p) => p ?? 'NEUTRAL'),
  // reason 도 wire 상 nullable(graphql String) — null/누락 시 빈 문자열로 완화.
  reason: z
    .string()
    .nullish()
    .transform((r) => r ?? ''),
});
export type SpeechToken = z.infer<typeof SpeechTokenSchema>;

export const SpeechAnalysisSchema = z.object({
  callId: z.string(),
  turnSeq: z.number().int(),
  tokens: z.array(SpeechTokenSchema).default([]),
});
export type SpeechAnalysis = z.infer<typeof SpeechAnalysisSchema>;

// ── onStrategyUpdate — 상담 전략 (SDL 정합) ───────────────────────────────────
// strategyHeadline = 큰 텍스트(.stx), rationale = 근거(.slead). turnSeq로 턴 식별.
// (구 data{live,static} 칩은 SSOT-3에서 폐기 — Next action 카드와 함께 제거.)
export const StrategyUpdateSchema = z.object({
  callId: z.string(),
  turnSeq: z.number().int().nullable().optional(),
  strategyHeadline: z.string(),
  rationale: z.string(),
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

// resultType은 백엔드가 핸드오프/승인 흔적이 없으면 null로 보낼 수 있어 옵셔널.
// endedAt도 즉시 채워지지 않을 수 있어 옵셔널(프론트는 종료 신호만 쓰면 충분).
export const CallEndedSchema = z.object({
  callId: z.string(),
  resultType: z.enum(CALL_RESULT_TYPES).nullable().optional(),
  endedAt: z.string().nullable().optional(),
});
export type CallEnded = z.infer<typeof CallEndedSchema>;
