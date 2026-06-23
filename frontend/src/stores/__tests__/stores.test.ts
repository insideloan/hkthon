// Unit tests for FRONTEND-011 (#40 Acceptance):
//   - onQueueUpdate mock → queueStore 갱신
//   - onIndexUpdate mock → callStore.churnRisk/emotion 갱신
//   - 재연결 로직 (구독 error 시 재구독)
//   - ws.ts / api.ts import 없음
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { useQueueStore } from '@/stores/queueStore';
import { useCallStore } from '@/stores/callStore';
import { useMotStore } from '@/stores/motStore';
import type { QueueResult } from '@/types/queue';
import type { IndexUpdate, Turn, MotDetected } from '@/types/realtime';

// ── Amplify mock — drive subscriptions by hand ───────────────────────────────
// Each .graphql().subscribe() registers its handlers so a test can emit a
// `next` payload or fire an `error` to exercise the reconnect path.
type Handlers = {
  next: (msg: { data?: unknown }) => void;
  error: (err: unknown) => void;
};
const opened: Handlers[] = [];
const unsubscribe = vi.fn();

vi.mock('aws-amplify', () => ({
  Amplify: { configure: vi.fn() },
}));
// graphql() serves double duty: subscription ops return a { subscribe } stream;
// query ops (fetchQueue's Queue query) resolve to { data }. We branch on whether
// the op string contains "subscription". queryResult is settable per-test.
let queryResult: unknown = { queue: { summary: {}, rows: [] } };
vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({
    graphql: (args: { query?: string }) => {
      if (typeof args?.query === 'string' && args.query.includes('subscription')) {
        return {
          subscribe: (handlers: Handlers) => {
            opened.push(handlers);
            return { unsubscribe };
          },
        };
      }
      return Promise.resolve({ data: queryResult });
    },
  }),
}));

// Import the SUT after the mocks are registered.
import {
  subscribeQueueUpdates,
  subscribeIndexUpdate,
} from '@/lib/appsync';

const queueResult: QueueResult = {
  summary: { total: 6, needsAgent: 1, fraudSuspected: 0, inCall: 2 },
  rows: [
    {
      callId: 'c1',
      customerName: '김고객',
      state: 'IN_CALL',
      stage: 'refi',
      assignee: 'AI 코파일럿',
      channel: '아웃바운드',
      highlight: null,
      elapsedSec: 42,
    },
  ],
};

const indexUpdate: IndexUpdate = { callId: 'c1', churnRisk: 72, emotion: '불안' };

beforeEach(() => {
  opened.length = 0;
  unsubscribe.mockReset();
  vi.useRealTimers();
  useQueueStore.getState().reset();
  useCallStore.getState().reset();
  useMotStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('queueStore ← onQueueUpdate', () => {
  it('refetches the snapshot when an onQueueUpdate delta arrives', async () => {
    // SDL: onQueueUpdate is a {callId, state} delta, not a full snapshot. The
    // subscription refetches the authoritative queue (graphql query mock below)
    // and feeds that snapshot to onData.
    queryResult = { queue: queueResult };
    subscribeQueueUpdates((result) => useQueueStore.getState().setQueue(result));
    expect(opened).toHaveLength(1);

    // A valid delta payload (callId + state) triggers the refetch.
    opened[0].next({ data: { onQueueUpdate: { callId: 'c1', state: 'IN_CALL' } } });
    await vi.waitFor(() => expect(useQueueStore.getState().rows).toHaveLength(1));

    const state = useQueueStore.getState();
    expect(state.summary).toEqual(queueResult.summary);
    expect(state.rows[0].callId).toBe('c1');
  });

  it('joins per-call churnRisk via mergeChurn (onIndexUpdate)', () => {
    useQueueStore.getState().setQueue(queueResult);
    useQueueStore.getState().mergeChurn('c1', 88);
    expect(useQueueStore.getState().rows[0].churnRisk).toBe(88);
  });
});

describe('callStore ← onIndexUpdate', () => {
  it('updates churnRisk/emotion when an onIndexUpdate message arrives', () => {
    useCallStore.getState().setCallId('c1');
    subscribeIndexUpdate('c1', (idx) => useCallStore.getState().setIndex(idx));
    expect(opened).toHaveLength(1);

    opened[0].next({ data: { onIndexUpdate: indexUpdate } });

    const state = useCallStore.getState();
    expect(state.churnRisk).toBe(72);
    expect(state.emotion).toBe('불안');
  });

  it('routes a malformed payload to onError, leaving the store untouched', () => {
    const onError = vi.fn();
    useCallStore.getState().setCallId('c1');
    subscribeIndexUpdate(
      'c1',
      (idx) => useCallStore.getState().setIndex(idx),
      onError,
    );

    // churnRisk out of range (>100) → schema rejects.
    opened[0].next({ data: { onIndexUpdate: { callId: 'c1', churnRisk: 999, emotion: 'x' } } });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(useCallStore.getState().churnRisk).toBeNull();
  });
});

describe('callStore.appendTurn / motStore.addMot ordering', () => {
  it('keeps turns ordered by seq and dedupes re-emits', () => {
    const t = (seq: number, text: string): Turn => ({
      callId: 'c1',
      seq,
      speaker: 'customer',
      text,
    });
    const store = useCallStore.getState();
    store.appendTurn(t(2, 'b'));
    store.appendTurn(t(1, 'a'));
    store.appendTurn(t(2, 'b-fixed')); // re-emit replaces in place

    const turns = useCallStore.getState().turns;
    expect(turns.map((x) => x.seq)).toEqual([1, 2]);
    expect(turns[1].text).toBe('b-fixed');
  });

  it('orders MOTs by seq and dedupes', () => {
    const m = (seq: number, outcome: MotDetected['outcome']): MotDetected => ({
      callId: 'c1',
      seq,
      type: 'RISK',
      turnSeq: seq,
      churnBefore: 40,
      churnAfter: 60,
      triggers: ['다른 은행'],
      outcome,
    });
    const store = useMotStore.getState();
    store.addMot(m(2, 'defended'));
    store.addMot(m(1, 'defended'));
    store.addMot(m(2, 'lost')); // re-emit updates outcome

    const mots = useMotStore.getState().mots;
    expect(mots.map((x) => x.seq)).toEqual([1, 2]);
    expect(mots[1].outcome).toBe('lost');
  });
});

describe('reconnect on subscription error', () => {
  it('resubscribes with backoff after a stream error', () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    subscribeIndexUpdate('c1', () => {}, onError);
    expect(opened).toHaveLength(1);

    // Fire a stream error → schedules a reconnect (1s backoff).
    opened[0].error(new Error('socket dropped'));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(opened).toHaveLength(1); // not yet — waiting on the timer

    vi.advanceTimersByTime(1000);
    expect(opened).toHaveLength(2); // reconnected
  });

  it('stops reconnecting once unsubscribed', () => {
    vi.useFakeTimers();
    const stop = subscribeIndexUpdate('c1', () => {});
    expect(opened).toHaveLength(1);

    stop(); // consumer cleanup
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    // An error after cleanup must NOT schedule a reconnect.
    opened[0].error(new Error('late error'));
    vi.advanceTimersByTime(60_000);
    expect(opened).toHaveLength(1);
  });
});

describe('legacy ws.ts / api.ts removed', () => {
  // vitest runs from the frontend package root, so resolve src/ from cwd.
  const libDir = resolve(process.cwd(), 'src/lib');

  it('has no lib/ws.ts or lib/api.ts on disk', () => {
    expect(existsSync(resolve(libDir, 'ws.ts'))).toBe(false);
    expect(existsSync(resolve(libDir, 'api.ts'))).toBe(false);
  });

  it('appsync.ts does not import the legacy ws/api clients', () => {
    const src = readFileSync(resolve(libDir, 'appsync.ts'), 'utf8');
    expect(src).not.toMatch(/['"]@\/lib\/ws['"]/);
    expect(src).not.toMatch(/['"]@\/lib\/api['"]/);
  });
});
