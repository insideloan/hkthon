// AppSync GraphQL client (Amplify v6). FRONTEND-owned single client + typed ops.
// Contract SSOT: graphql/schema.graphql (BACKEND, pending #22). Endpoint/key come
// from CDK CfnOutput, injected as NEXT_PUBLIC_* env (see frontend/.env.example,
// docs/cloud/env-distribution.md).
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/api';
import type { V6Client } from '@aws-amplify/api-graphql';
import type { ZodTypeAny, TypeOf } from 'zod';
import {
  QueueResultSchema,
  QueueUpdatePayloadSchema,
  type QueueResult,
  type QueueRow,
  type QueueSummary,
} from '@/types/queue';
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
import { isMockLiveCall, subscribeMockLive } from '@/lib/mockLive';

let configured = false;

// Demo/offline mode: when NEXT_PUBLIC_USE_MOCK is set, queue ops serve local
// fixtures instead of hitting AppSync. Lets the dashboard render populated rows
// before the backend schema (BACKEND-009) is deployed, and avoids the live
// subscription's reconnect loop. Unset in prod → real AppSync path, unchanged.
const USE_MOCK =
  process.env.NEXT_PUBLIC_USE_MOCK === '1' ||
  process.env.NEXT_PUBLIC_USE_MOCK === 'true';

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

// ── mock queue fixture (NEXT_PUBLIC_USE_MOCK) ────────────────────────────────
// Shaped to QueueResultSchema. Mirrors the demo-booth scenarios so the table
// shows the highlight states (needs_agent / fraud_suspected) and churn bar.
function mockQueue(): QueueResult {
  // Mirrors the SSOT demo call-list (docs/consult_redesigned-3.html CALLS) and
  // the backend seed (lambda/orchestrator/seed.py SEED_QUEUE_ROWS) so the admin
  // table drill-in flow is demoable offline. The 박서준 row carries state DIALING
  // + the 사전 분석중 stage so it routes to the segment analysis screen.
  const rows: QueueRow[] = [
    { callId: 'c-demo-01', customerName: '박서준', subtitle: '38세·KCB744', state: 'DIALING', stage: '사전 분석중',
      assignee: 'Agent #3', channel: '아웃바운드', highlight: null, elapsedSec: 0, churnRisk: 34 },
    { callId: 'c-demo-02', customerName: '이정훈', subtitle: '45세·KCB701', state: 'IN_CALL', stage: '우려 해소중',
      assignee: 'Agent #7', channel: '아웃바운드', highlight: null, elapsedSec: 221, churnRisk: 48 },
    { callId: 'c-demo-03', customerName: '김하늘', subtitle: '33세·KCB762', state: 'IN_CALL', stage: '신뢰 형성중',
      assignee: 'Agent #2', channel: '인바운드', highlight: null, elapsedSec: 68, churnRisk: 34 },
    { callId: 'c-demo-04', customerName: '정민서', subtitle: '29세·KCB688', state: 'TRANSFER_PENDING', stage: '연결 대기',
      assignee: null, channel: '인바운드', highlight: 'needs_agent', elapsedSec: 0, churnRisk: 55 },
    { callId: 'c-demo-05', customerName: '한지우', subtitle: '51세·KCB720', state: 'TRANSFER_PENDING', stage: '연결 대기',
      assignee: null, channel: '아웃바운드', highlight: 'needs_agent', elapsedSec: 0, churnRisk: 40 },
    { callId: 'c-demo-06', customerName: '오세훈', subtitle: '41세·KCB745', state: 'ENDED', stage: '문자URL 발송',
      assignee: 'Agent #1', channel: '인바운드', highlight: null, elapsedSec: 475, churnRisk: 18 },
    { callId: 'c-demo-07', customerName: '배수지', subtitle: '36세·KCB733', state: 'ENDED', stage: '대출 접수',
      assignee: 'Agent #4', channel: '아웃바운드', highlight: null, elapsedSec: 330, churnRisk: 12 },
    { callId: 'c-demo-08', customerName: '윤재호', subtitle: '48세·KCB695', state: 'ENDED', stage: '차량명의 이탈',
      assignee: 'Agent #11', channel: '아웃바운드', highlight: null, elapsedSec: 134, churnRisk: 88 },
    { callId: 'c-demo-09', customerName: '강예린', subtitle: '27세·KCB710', state: 'ENDED', stage: 'TM거부 이탈',
      assignee: 'Agent #13', channel: '인바운드', highlight: null, elapsedSec: 46, churnRisk: 94 },
  ];
  const summary: QueueSummary = {
    total: rows.length,
    needsAgent: rows.filter((r) => r.highlight === 'needs_agent').length,
    fraudSuspected: rows.filter((r) => r.highlight === 'fraud_suspected').length,
    inCall: rows.filter((r) => r.state === 'IN_CALL').length,
  };
  return { summary, rows };
}

// ── queue (initial load) — API.md §1.1 ───────────────────────────────────────
const QUEUE_QUERY = /* GraphQL */ `
  query Queue($highlightOnly: Boolean) {
    queue(highlightOnly: $highlightOnly) {
      summary { total needsAgent fraudSuspected inCall }
      rows {
        callId customerName subtitle state stage churnRisk
        assignee channel elapsedSec highlight
      }
    }
  }
`;

export async function fetchQueue(highlightOnly = false): Promise<QueueResult> {
  if (USE_MOCK) {
    const result = mockQueue();
    if (highlightOnly) {
      return { ...result, rows: result.rows.filter((r) => r.highlight) };
    }
    return result;
  }
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
// SDL: onQueueUpdate returns QueueUpdatePayload { callId, state } — a per-call
// delta, NOT a full snapshot. dialCall / state changes fan out via Streams →
// _emitQueueUpdate. On each delta we refetch the full queue (demo scale: a
// handful of rows, single query) and hand the fresh snapshot to onData.
const ON_QUEUE_UPDATE_SUB = /* GraphQL */ `
  subscription OnQueueUpdate {
    onQueueUpdate { callId state }
  }
`;

type OnQueueUpdate = { onQueueUpdate: { callId: string; state?: string | null } };

/**
 * Subscribe to live queue updates. Returns an unsubscribe function.
 * Each `onQueueUpdate` delta triggers a full queue refetch; the resulting
 * snapshot is delivered via onData. Refetch/parse failures route to onError.
 */
export function subscribeQueueUpdates(
  onData: (result: QueueResult) => void,
  onError?: (err: unknown) => void,
): () => void {
  if (USE_MOCK) {
    // Tick elapsed time every second so the demo feels live; no real socket
    // (so no reconnect loop against the real endpoint).
    const base = mockQueue();
    let tick = 0;
    const timer = setInterval(() => {
      tick += 1;
      onData({
        ...base,
        rows: base.rows.map((r) =>
          r.state === 'ENDED' ? r : { ...r, elapsedSec: (r.elapsedSec ?? 0) + tick },
        ),
      });
    }, 1000);
    return () => clearInterval(timer);
  }
  return subscribeWithReconnect(
    { query: ON_QUEUE_UPDATE_SUB },
    (d) => (d as OnQueueUpdate | undefined)?.onQueueUpdate,
    QueueUpdatePayloadSchema,
    () => {
      // Delta only tells us *something* changed — refetch the authoritative snapshot.
      fetchQueue().then(onData).catch((err) => onError?.(err));
    },
    onError,
  );
}

// ── deleteQueueRow mutation — admin manual queue clear ───────────────────────
// SDL: deleteQueueRow(callId: ID!): DeleteQueueRowResult! — permanently removes a
// call from the queue (index + META + customer ACTIVE_CALL pointer). Idempotent.
// Other admin clients refresh via the onQueueUpdate delta the resolver emits.
const DELETE_QUEUE_ROW_MUTATION = /* GraphQL */ `
  mutation DeleteQueueRow($callId: ID!) {
    deleteQueueRow(callId: $callId) {
      ok
      callId
    }
  }
`;

export async function deleteQueueRow(callId: string): Promise<{ ok: boolean; callId: string }> {
  if (USE_MOCK) return { ok: true, callId };
  const res = await getClient().graphql({
    query: DELETE_QUEUE_ROW_MUTATION,
    variables: { callId },
  });
  if ('data' in res && res.data) {
    const d = (res.data as { deleteQueueRow: { ok: boolean; callId: string } }).deleteQueueRow;
    return { ok: d.ok, callId: d.callId };
  }
  throw new Error('deleteQueueRow 응답을 받지 못했습니다.');
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
// 주의: phase는 wire에서 대문자 enum(DRAFTING…). violatedPolicies는 [String]. (SDL 정합)

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
  if (USE_MOCK && isMockLiveCall(callId)) {
    return subscribeMockLive(callId, 'compliance', (p) => onData(p as ComplianceState));
  }
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
      audioUrl
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
  // mock 빌드의 체험 라이브 콜(exp-*)은 로컬 시뮬레이터에서 이벤트를 받는다.
  if (USE_MOCK && isMockLiveCall(callId)) {
    return subscribeMockLive(callId, 'turn', (p) => onData(p as Turn));
  }
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
      dbChips
      dbNodes { label val tone }
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
  if (USE_MOCK && isMockLiveCall(callId)) {
    return subscribeMockLive(callId, 'speech', (p) => onData(p as SpeechAnalysis));
  }
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
      strategyHeadline
      rationale
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
  if (USE_MOCK && isMockLiveCall(callId)) {
    return subscribeMockLive(callId, 'strategy', (p) => onData(p as StrategyUpdate));
  }
  return subscribeWithReconnect(
    { query: ON_STRATEGY_UPDATE_SUB, variables: { callId } },
    (d) => (d as OnStrategyUpdate | undefined)?.onStrategyUpdate,
    StrategyUpdateSchema,
    onData,
    onError,
  );
}

// ── mots (initial load) — API.md §2.7 ────────────────────────────────────────
// BACKEND-007 pending. Returns detected MOTs for a call (may be empty before any
// MOT fires). Used by JourneyMap for initial hydration on mount.
const MOTS_QUERY = /* GraphQL */ `
  query Mots($callId: ID!) {
    mots(callId: $callId) {
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

export async function fetchMots(callId: string): Promise<MotDetected[]> {
  if (USE_MOCK) return [];
  const res = await getClient().graphql({ query: MOTS_QUERY, variables: { callId } });
  if ('data' in res && res.data) {
    const raw = (res.data as { mots: unknown[] }).mots ?? [];
    return raw.map((m) => MotDetectedSchema.parse(m));
  }
  throw new Error('mots 쿼리 응답을 받지 못했습니다.');
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

// ── dialCall mutation — FRONTEND-002 / #31 ───────────────────────────────────
// SDL: dialCall(customerId: ID!): Call! — starts an outbound call FOR A CUSTOMER
// and returns the new Call (state=DIALING, `id`). It does NOT take an analysis
// callId; the navigation target is the freshly-created call's id.
const DIAL_CALL_MUTATION = /* GraphQL */ `
  mutation DialCall($customerId: ID!) {
    dialCall(customerId: $customerId) {
      id
      state
    }
  }
`;

export type DialCallResult = { callId: string; state: string };

export async function dialCall(customerId: string): Promise<DialCallResult> {
  if (USE_MOCK) return { callId: `mock-call-${customerId}`, state: 'DIALING' };
  const res = await getClient().graphql({
    query: DIAL_CALL_MUTATION,
    variables: { customerId },
  });
  if ('data' in res && res.data) {
    const d = (res.data as { dialCall: { id: string; state: string } }).dialCall;
    return { callId: d.id, state: d.state };
  }
  throw new Error('dialCall 응답을 받지 못했습니다.');
}

// ── createCall mutation — FRONTEND-003 / #32 (analysis-only, not dialing) ────
// Creates a call record for pre-analysis. Does NOT dial. Returns callId.
// SDL: createCall(customerId: ID!): Call! — Call exposes `id` (not callId).
const CREATE_CALL_MUTATION = /* GraphQL */ `
  mutation CreateCall($customerId: ID!) {
    createCall(customerId: $customerId) {
      id
      state
    }
  }
`;

export type CreateCallResult = { callId: string; state: string };

export async function createCall(customerId: string): Promise<CreateCallResult> {
  if (USE_MOCK) return { callId: `mock-${customerId}`, state: 'ANALYZING' };
  const res = await getClient().graphql({
    query: CREATE_CALL_MUTATION,
    variables: { customerId },
  });
  if ('data' in res && res.data) {
    const d = (res.data as { createCall: { id: string; state: string } }).createCall;
    return { callId: d.id, state: d.state };
  }
  throw new Error('createCall 응답을 받지 못했습니다.');
}

// ── 라이브 오디오 뮤테이션 (체험 라이브 세션) ────────────────────────────────
// SDL: startAudio(callId): Boolean / audioChunk(callId, data): Boolean / nextTurn(callId): Turn.
// 라이브 모드(ORCHESTRATOR_MODE=live) 백엔드에서 STT→agent→TTS를 구동한다.
// mock 빌드/스크립트 모드에서는 백엔드가 no-op이므로 클라이언트도 안전하게 단락한다.
const START_AUDIO_MUTATION = /* GraphQL */ `
  mutation StartAudio($callId: ID!, $customerName: String) {
    startAudio(callId: $callId, customerName: $customerName)
  }
`;

const AUDIO_CHUNK_MUTATION = /* GraphQL */ `
  mutation AudioChunk($callId: ID!, $data: String!) {
    audioChunk(callId: $callId, data: $data)
  }
`;

/**
 * 라이브 오디오 세션 시작. mock 모드는 true(로컬 시뮬레이션 경로).
 *
 * customerName: 체험 고객(exp-*)은 DynamoDB에 레코드가 없어 백엔드가 이름을 몰라
 * AI 인사말이 <고객명> placeholder가 된다. 이름을 함께 넘기면 백엔드가 최소 고객
 * 컨텍스트를 만들어 프롬프트에 주입한다(미지정이면 기존 동작).
 */
export async function startAudio(callId: string, customerName?: string): Promise<boolean> {
  if (USE_MOCK) return true;
  const res = await getClient().graphql({
    query: START_AUDIO_MUTATION,
    variables: { callId, customerName: customerName ?? null },
  });
  if ('data' in res && res.data) {
    return Boolean((res.data as { startAudio: boolean }).startAudio);
  }
  return false;
}

/**
 * base64 PCM(16kHz mono) 오디오 청크를 전송. 백엔드가 STT→customer Turn→agent→bot Turn.
 * mock 모드는 no-op(true) — 전송할 실제 백엔드가 없다.
 */
export async function audioChunk(callId: string, data: string): Promise<boolean> {
  if (USE_MOCK) return true;
  const res = await getClient().graphql({ query: AUDIO_CHUNK_MUTATION, variables: { callId, data } });
  if ('data' in res && res.data) {
    return Boolean((res.data as { audioChunk: boolean }).audioChunk);
  }
  return false;
}

// ── customer query — FRONTEND-003 / #32 ──────────────────────────────────────
// Fetches basic customer info for the pre-analysis screen.
// SDL: customer(id: ID!): Customer! — arg is `id`, and Customer exposes `id`
// (not customerId) with no `age` field (graphql/schema.graphql). The age shown in
// the segment header is design-fixed in the SSOT, so we leave it null here.
const CUSTOMER_QUERY = /* GraphQL */ `
  query Customer($id: ID!) {
    customer(id: $id) {
      id
      name
      phone
      targetProduct
    }
  }
`;

export type Customer = {
  customerId: string;
  name: string;
  age: number | null;
  phone: string | null;
  targetProduct: string | null;
};

type CustomerWire = {
  id: string;
  name: string | null;
  phone: string | null;
  targetProduct: string | null;
};

export async function fetchCustomer(customerId: string): Promise<Customer> {
  if (USE_MOCK) {
    return { customerId, name: '박서준', age: 38, phone: '010-****-2840', targetProduct: '대환대출' };
  }
  const res = await getClient().graphql({
    query: CUSTOMER_QUERY,
    variables: { id: customerId },
  });
  if ('data' in res && res.data) {
    const d = (res.data as { customer: CustomerWire }).customer;
    return {
      customerId: d.id,
      name: d.name ?? '',
      age: null,
      phone: d.phone,
      targetProduct: d.targetProduct,
    };
  }
  throw new Error('customer 쿼리 응답을 받지 못했습니다.');
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
  if (USE_MOCK && isMockLiveCall(callId)) {
    return subscribeMockLive(callId, 'callended', (p) => onData(p as CallEnded));
  }
  return subscribeWithReconnect(
    { query: ON_CALL_ENDED_SUB, variables: { callId } },
    (d) => (d as OnCallEnded | undefined)?.onCallEnded,
    CallEndedSchema,
    onData,
    onError,
  );
}
