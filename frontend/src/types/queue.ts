// Queue wire types — mirror of the AppSync GraphQL contract.
//
// Contract status: the real schema (graphql/schema.graphql, BACKEND-owned) lands
// in BACKEND-003 (#22) / CLOUD-007 (#49). Until then this is hand-mirrored from
// the dashboard contract in reference/API.md §1.1 (GET /api/queue), expressed in
// AppSync GraphQL camelCase (the snake_case in API.md is the deprecated REST
// stack). Keep in sync when BACKEND publishes the real SDL — see CONVENTIONS.md
// §4 (no codegen yet).
import { z } from 'zod';

// CallState — reference/API.md state machine. Mirrors SDL `enum CallState`.
export const CALL_STATES = [
  'DIALING',
  'RINGING',
  'ACCEPTED',
  'REJECTED',
  'IN_CALL',
  'TRANSFER_PENDING',
  'AGENT_JOINED',
  'ENDED',
] as const;
export type CallState = (typeof CALL_STATES)[number];

// highlight ∈ null | "needs_agent" | "fraud_suspected" (API.md §1.1).
export const QUEUE_HIGHLIGHTS = ['needs_agent', 'fraud_suspected'] as const;
export type QueueHighlight = (typeof QUEUE_HIGHLIGHTS)[number];

// Summary cards — 5종 (대기콜/진행중/상담원 연결 필요/금융사기 의심/종료).
export const QueueSummarySchema = z.object({
  waiting: z.number().int(),
  inProgress: z.number().int(),
  needsAgent: z.number().int(),
  fraudSuspected: z.number().int(),
  ended: z.number().int(),
});
export type QueueSummary = z.infer<typeof QueueSummarySchema>;

export const QueueRowSchema = z.object({
  callId: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  targetProduct: z.string(),
  state: z.enum(CALL_STATES),
  scenario: z.string(),
  highlight: z.enum(QUEUE_HIGHLIGHTS).nullable().optional(),
  highlightSince: z.string().nullable().optional(),
  elapsedSec: z.number().int(),
  // churnRisk is NOT part of the queue wire contract (API.md §1.1). The admin
  // table joins per-call churn from the onIndexUpdate subscription, keyed by
  // callId — display-only, optional. See queueStore.mergeChurn().
  churnRisk: z.number().int().min(0).max(100).nullable().optional(),
});
export type QueueRow = z.infer<typeof QueueRowSchema>;

export const QueueResultSchema = z.object({
  summary: QueueSummarySchema,
  rows: z.array(QueueRowSchema),
});
export type QueueResult = z.infer<typeof QueueResultSchema>;
