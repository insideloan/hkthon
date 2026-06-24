// Queue wire types — mirror of the AppSync GraphQL contract.
//
// Contract SSOT: graphql/schema.graphql (BACKEND-owned), types QueueResult /
// QueueSummary / QueueRow + enum CallState. This file is the TS mirror — keep in
// sync with the deployed SDL (CONVENTIONS.md §4, no codegen yet). The earlier
// REST-derived shape (customerId/targetProduct/scenario, waiting/inProgress/ended)
// was retired when the real SDL landed.
import { z } from 'zod';

// CallState — mirrors SDL `enum CallState`
// (graphql/schema.graphql: CREATED DIALING IN_CALL TRANSFER_PENDING ENDED).
export const CALL_STATES = [
  'CREATED',
  'DIALING',
  'IN_CALL',
  'TRANSFER_PENDING',
  'ENDED',
] as const;
export type CallState = (typeof CALL_STATES)[number];

// highlight ∈ null | "needs_agent" | "fraud_suspected" (resolver _highlight()).
export const QUEUE_HIGHLIGHTS = ['needs_agent', 'fraud_suspected'] as const;
export type QueueHighlight = (typeof QUEUE_HIGHLIGHTS)[number];

// SDL: type QueueSummary { total, needsAgent, fraudSuspected, inCall }.
export const QueueSummarySchema = z.object({
  total: z.number().int(),
  needsAgent: z.number().int(),
  fraudSuspected: z.number().int(),
  inCall: z.number().int(),
});
export type QueueSummary = z.infer<typeof QueueSummarySchema>;

// SDL: type QueueRow { callId, customerName, subtitle, state, stage, churnRisk,
// assignee, channel, elapsedSec, highlight }. All non-callId fields are nullable.
export const QueueRowSchema = z.object({
  callId: z.string(),
  customerName: z.string().nullable().optional(),
  subtitle: z.string().nullable().optional(),
  state: z.enum(CALL_STATES).nullable().optional(),
  stage: z.string().nullable().optional(),
  churnRisk: z.number().int().nullable().optional(),
  assignee: z.string().nullable().optional(),
  channel: z.string().nullable().optional(),
  elapsedSec: z.number().int().nullable().optional(),
  highlight: z.enum(QUEUE_HIGHLIGHTS).nullable().optional(),
});
export type QueueRow = z.infer<typeof QueueRowSchema>;

export const QueueResultSchema = z.object({
  summary: QueueSummarySchema,
  rows: z.array(QueueRowSchema),
});
export type QueueResult = z.infer<typeof QueueResultSchema>;

// SDL: type QueueUpdatePayload { callId, state } — onQueueUpdate delta (per-call,
// NOT a full snapshot). Consumers refetch the queue on each delta.
export const QueueUpdatePayloadSchema = z.object({
  callId: z.string(),
  state: z.enum(CALL_STATES).nullable().optional(),
});
export type QueueUpdatePayload = z.infer<typeof QueueUpdatePayloadSchema>;
