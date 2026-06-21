// AppSync GraphQL client (Amplify v6). FRONTEND-owned single client + typed ops.
// Contract SSOT: graphql/schema.graphql (BACKEND, pending #22). Endpoint/key come
// from CDK CfnOutput, injected as NEXT_PUBLIC_* env (see frontend/.env.example,
// docs/cloud/env-distribution.md).
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/api';
import type { V6Client } from '@aws-amplify/api-graphql';
import type { ZodTypeAny, TypeOf } from 'zod';
import { QueueResultSchema, type QueueResult } from '@/types/queue';
import { ComplianceStateSchema, type ComplianceState } from '@/types/compliance';
import {
  TurnSchema,
  type Turn,
  IndexUpdateSchema,
  type IndexUpdate,
  SpeechAnalysisSchema,
  type SpeechAnalysis,
  StrategyUpdateSchema,
  type StrategyUpdate,
  MotDetectedSchema,
  type MotDetected,
  CallEndedSchema,
  type CallEnded,
} from '@/types/realtime';

let configured = false;

/** Configure Amplify once from public env. Safe to call repeatedly. */
export function configureAppSync(): void {
  if (configured) return;
  const endpoint = process.env.NEXT_PUBLIC_APPSYNC_URL;
  const apiKey = process.env.NEXT_PUBLIC_APPSYNC_API_KEY;
  if (!endpoint || !apiKey) {
    // Missing config is non-fatal at import time (e.g. unit tests / SSG).
    // Real calls will surface a clear AppSync error.
    return;
  }
  Amplify.configure({
    API: {
      GraphQL: {
        endpoint,
        region: process.env.NEXT_PUBLIC_AWS_REGION ?? 'ap-northeast-2',
        defaultAuthMode: 'apiKey',
        apiKey,
      },
    },
  });
  configured = true;
}

// Lazily-created singleton. Annotated with Amplify's public V6Client type;
// using ReturnType<typeof generateClient> here triggers a TS2321
// "Excessive stack depth" error from the untyped-string graphql() overloads.
let client: V6Client | undefined;

function getClient(): V6Client {
  configureAppSync();
  // `as V6Client`: structurally comparing generateClient()'s return against
  // V6Client overflows TS (Amplify v6 type bug). The cast targets the library's
  // own public client type — not a widening to `any`.
  if (!client) client = generateClient() as unknown as V6Client;
  return client;
}

// ── subscription core (validate + reconnect) ─────────────────────────────────
// Every subscribe* helper routes through this. It:
//   1. runs each payload through its zod schema (parse fail → onError, never
//      throws into the stream), and
//   2. on a stream `error`, auto-resubscribes with exponential backoff
//      (1s, 2s, 4s … capped at 30s) so a dropped AppSync socket self-heals.
// The returned function unsubscribes AND cancels any pending reconnect, so a
// consumer's cleanup is final (no zombie resubscribe after unmount).
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

type SubscribeArgs = { query: string; variables?: Record<string, unknown> };

// A subscription stream that yields `{ data }` and can be unsubscribed. The
// Amplify v6 graphql() return type is a conditional that doesn't narrow for a
// generic payload, so we structurally type just the bit we use and cast at the
// single call site below (not a widen to `any`).
type GraphqlStream = {
  subscribe: (h: {
    next: (msg: { data?: unknown }) => void;
    error: (err: unknown) => void;
  }) => { unsubscribe: () => void };
};

function subscribeWithReconnect<TSchema extends ZodTypeAny>(
  args: SubscribeArgs,
  pick: (data: unknown) => unknown,
  schema: TSchema,
  onData: (value: TypeOf<TSchema>) => void,
  onError?: (err: unknown) => void,
): () => void {
  let unsub: (() => void) | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let closed = false;

  const open = (): void => {
    if (closed) return;
    const stream = getClient().graphql(args) as unknown as GraphqlStream;
    const sub = stream
      .subscribe({
        next: ({ data }: { data?: unknown }) => {
          attempt = 0; // a good message means the socket is healthy again
          const parsed = schema.safeParse(pick(data));
          if (parsed.success) onData(parsed.data);
          else onError?.(parsed.error);
        },
        error: (err: unknown) => {
          onError?.(err);
          if (closed) return;
          const delay = Math.min(
            RECONNECT_BASE_MS * 2 ** attempt,
            RECONNECT_MAX_MS,
          );
          attempt += 1;
          retryTimer = setTimeout(open, delay);
        },
      });
    unsub = () => sub.unsubscribe();
  };

  open();

  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    unsub?.();
  };
}

// ── queue (initial load) — API.md §1.1 ───────────────────────────────────────
const QUEUE_QUERY = /* GraphQL */ `
  query Queue($highlightOnly: Boolean) {
    queue(highlightOnly: $highlightOnly) {
      summary { waiting inProgress needsAgent fraudSuspected ended }
      rows {
        callId customerId customerName targetProduct
        state scenario highlight highlightSince elapsedSec
      }
    }
  }
`;

export async function fetchQueue(highlightOnly = false): Promise<QueueResult> {
  const res = await getClient().graphql({
    query: QUEUE_QUERY,
    variables: { highlightOnly },
  });
  if ('data' in res) {
    return QueueResultSchema.parse(res.data.queue);
  }
  throw new Error('queue 쿼리 응답을 받지 못했습니다.');
}

// ── onQueueUpdate (realtime) ─────────────────────────────────────────────────
const ON_QUEUE_UPDATE_SUB = /* GraphQL */ `
  subscription OnQueueUpdate {
    onQueueUpdate {
      summary { waiting inProgress needsAgent fraudSuspected ended }
      rows {
        callId customerId customerName targetProduct
        state scenario highlight highlightSince elapsedSec
      }
    }
  }
`;

type OnQueueUpdate = { onQueueUpdate: QueueResult };

/**
 * Subscribe to live queue updates. Returns an unsubscribe function.
 * Parse failures are routed to onError instead of throwing in the stream.
 */
export function subscribeQueueUpdates(
  onData: (result: QueueResult) => void,
  onError?: (err: unknown) => void,
): () => void {
  return subscribeWithReconnect(
    { query: ON_QUEUE_UPDATE_SUB },
    (d) => (d as OnQueueUpdate | undefined)?.onQueueUpdate,
    QueueResultSchema,
    onData,
    onError,
  );
}

// ── onComplianceState (realtime) — FRONTEND-008 / #37 ────────────────────────
// Drives the compliance panel state machine (drafting → reviewing → redacting →
// redrafting → approved). Producer: AGENT-010 (#18); contract pending in
// graphql/schema.graphql.
const ON_COMPLIANCE_STATE_SUB = /* GraphQL */ `
  subscription OnComplianceState($callId: ID!) {
    onComplianceState(callId: $callId) {
      callId
      phase
      draft
      violations
      checks { law desc flagged }
      violatedPolicies
      final { text del ins added }
    }
  }
`;

type OnComplianceState = { onComplianceState: ComplianceState };

/**
 * Subscribe to compliance state-machine transitions for a call.
 * Returns an unsubscribe function. Parse failures route to onError.
 */
export function subscribeComplianceState(
  callId: string,
  onData: (state: ComplianceState) => void,
  onError?: (err: unknown) => void,
): () => void {
  return subscribeWithReconnect(
    { query: ON_COMPLIANCE_STATE_SUB, variables: { callId } },
    (d) => (d as OnComplianceState | undefined)?.onComplianceState,
    ComplianceStateSchema,
    onData,
    onError,
  );
}

// ── onTurn (realtime) — API.md §2.2 ──────────────────────────────────────────
// Per-utterance stream during a call. Producer: AGENT (STT) / nextTurn (script).
const ON_TURN_SUB = /* GraphQL */ `
  subscription OnTurn($callId: ID!) {
    onTurn(callId: $callId) {
      callId
      seq
      speaker
      text
    }
  }
`;

type OnTurn = { onTurn: Turn };

/** Subscribe to live turns for a call. Returns an unsubscribe function. */
export function subscribeTurns(
  callId: string,
  onData: (turn: Turn) => void,
  onError?: (err: unknown) => void,
): () => void {
  return subscribeWithReconnect(
    { query: ON_TURN_SUB, variables: { callId } },
    (d) => (d as OnTurn | undefined)?.onTurn,
    TurnSchema,
    onData,
    onError,
  );
}

// ── onIndexUpdate (realtime) — API.md §2.3 ───────────────────────────────────
// 이탈위험도(churnRisk 0-100) + 감정(emotion). Producer: AGENT (CHURN-RISK-LEXICON
// SSOT). FRONTEND consumes only — never computes the score.
const ON_INDEX_UPDATE_SUB = /* GraphQL */ `
  subscription OnIndexUpdate($callId: ID!) {
    onIndexUpdate(callId: $callId) {
      callId
      churnRisk
      emotion
    }
  }
`;

type OnIndexUpdate = { onIndexUpdate: IndexUpdate };

/** Subscribe to churn/emotion index updates. Returns an unsubscribe function. */
export function subscribeIndexUpdate(
  callId: string,
  onData: (index: IndexUpdate) => void,
  onError?: (err: unknown) => void,
): () => void {
  return subscribeWithReconnect(
    { query: ON_INDEX_UPDATE_SUB, variables: { callId } },
    (d) => (d as OnIndexUpdate | undefined)?.onIndexUpdate,
    IndexUpdateSchema,
    onData,
    onError,
  );
}

// ── onSpeechAnalysis (realtime) — API.md §2.4 ────────────────────────────────
// 발화 분석 토큰 (PRO/CONS/NEUTRAL + reason). Producer: AGENT.
const ON_SPEECH_ANALYSIS_SUB = /* GraphQL */ `
  subscription OnSpeechAnalysis($callId: ID!) {
    onSpeechAnalysis(callId: $callId) {
      callId
      turnSeq
      tokens { text polarity reason }
    }
  }
`;

type OnSpeechAnalysis = { onSpeechAnalysis: SpeechAnalysis };

/** Subscribe to per-turn speech analysis. Returns an unsubscribe function. */
export function subscribeSpeechAnalysis(
  callId: string,
  onData: (analysis: SpeechAnalysis) => void,
  onError?: (err: unknown) => void,
): () => void {
  return subscribeWithReconnect(
    { query: ON_SPEECH_ANALYSIS_SUB, variables: { callId } },
    (d) => (d as OnSpeechAnalysis | undefined)?.onSpeechAnalysis,
    SpeechAnalysisSchema,
    onData,
    onError,
  );
}

// ── onStrategyUpdate (realtime) — API.md §2.5 ────────────────────────────────
// 상담 전략 (headline + rationale + live/static data). Producer: AGENT.
const ON_STRATEGY_UPDATE_SUB = /* GraphQL */ `
  subscription OnStrategyUpdate($callId: ID!) {
    onStrategyUpdate(callId: $callId) {
      callId
      turnSeq
      headline
      rationale
      data {
        live { lastIntent }
        static { creditScore }
      }
    }
  }
`;

type OnStrategyUpdate = { onStrategyUpdate: StrategyUpdate };

/** Subscribe to strategy-panel updates. Returns an unsubscribe function. */
export function subscribeStrategyUpdate(
  callId: string,
  onData: (strategy: StrategyUpdate) => void,
  onError?: (err: unknown) => void,
): () => void {
  return subscribeWithReconnect(
    { query: ON_STRATEGY_UPDATE_SUB, variables: { callId } },
    (d) => (d as OnStrategyUpdate | undefined)?.onStrategyUpdate,
    StrategyUpdateSchema,
    onData,
    onError,
  );
}

// ── onMotDetected (realtime) — API.md §2.7 ───────────────────────────────────
// MOT 마커 (RISK/CONVERSION). Producer: AGENT (MOT 탐지 규칙).
const ON_MOT_DETECTED_SUB = /* GraphQL */ `
  subscription OnMotDetected($callId: ID!) {
    onMotDetected(callId: $callId) {
      callId
      seq
      type
      turnSeq
      churnBefore
      churnAfter
      triggers
      strategy { tactic headline }
      outcome
      narrative
    }
  }
`;

type OnMotDetected = { onMotDetected: MotDetected };

/** Subscribe to MOT marker detections. Returns an unsubscribe function. */
export function subscribeMotDetected(
  callId: string,
  onData: (mot: MotDetected) => void,
  onError?: (err: unknown) => void,
): () => void {
  return subscribeWithReconnect(
    { query: ON_MOT_DETECTED_SUB, variables: { callId } },
    (d) => (d as OnMotDetected | undefined)?.onMotDetected,
    MotDetectedSchema,
    onData,
    onError,
  );
}

// ── onCallEnded (realtime) — API.md §2.8 ─────────────────────────────────────
// 통화 종료 → CRM 화면 전환 트리거. Producer: AGENT / endCall.
const ON_CALL_ENDED_SUB = /* GraphQL */ `
  subscription OnCallEnded($callId: ID!) {
    onCallEnded(callId: $callId) {
      callId
      resultType
      endedAt
    }
  }
`;

type OnCallEnded = { onCallEnded: CallEnded };

/** Subscribe to the call-ended event. Returns an unsubscribe function. */
export function subscribeCallEnded(
  callId: string,
  onData: (ended: CallEnded) => void,
  onError?: (err: unknown) => void,
): () => void {
  return subscribeWithReconnect(
    { query: ON_CALL_ENDED_SUB, variables: { callId } },
    (d) => (d as OnCallEnded | undefined)?.onCallEnded,
    CallEndedSchema,
    onData,
    onError,
  );
}
