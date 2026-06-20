// AppSync GraphQL client (Amplify v6). FRONTEND-owned single client + typed ops.
// Contract SSOT: graphql/schema.graphql (BACKEND, pending #22). Endpoint/key come
// from CDK CfnOutput, injected as NEXT_PUBLIC_* env (see frontend/.env.example,
// docs/cloud/env-distribution.md).
import { Amplify } from 'aws-amplify';
import { generateClient, type GraphQLSubscription } from 'aws-amplify/api';
import type { V6Client } from '@aws-amplify/api-graphql';
import { QueueResultSchema, type QueueResult } from '@/types/queue';

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
  const sub = getClient()
    .graphql<GraphQLSubscription<OnQueueUpdate>>({ query: ON_QUEUE_UPDATE_SUB })
    .subscribe({
      next: ({ data }) => {
        const parsed = QueueResultSchema.safeParse(data?.onQueueUpdate);
        if (parsed.success) onData(parsed.data);
        else onError?.(parsed.error);
      },
      error: (err: unknown) => onError?.(err),
    });
  return () => sub.unsubscribe();
}
