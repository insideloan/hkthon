// mockLive — 오프라인(NEXT_PUBLIC_USE_MOCK) 라이브 세션 시뮬레이터.
//
// 라이브 백엔드(ORCHESTRATOR_MODE=live)가 없는 mock 빌드에서 체험 라이브 세션을
// 데모 가능하게 한다. 체험 콜(exp-*)에 구독이 붙으면, 스크립트된 순서로
// onTurn / onSpeechAnalysis / onStrategyUpdate / onComplianceState 이벤트를
// 흘려보내 트랜스크립트와 우측 3카드가 함께 채워지게 한다.
//
// 실 배포(live 백엔드)에서는 subscribe* 가 실제 AppSync 소켓을 쓰므로 이 모듈은
// 사용되지 않는다(USE_MOCK 게이트). 한 콜당 1회만 재생한다.
import type { Turn, SpeechAnalysis, StrategyUpdate } from '@/types/realtime';
import type { ComplianceState } from '@/types/compliance';

export type MockLiveChannel = 'turn' | 'speech' | 'strategy' | 'compliance';

type Handler = (payload: unknown) => void;

type CallBus = {
  handlers: Record<MockLiveChannel, Set<Handler>>;
  started: boolean;
  timers: ReturnType<typeof setTimeout>[];
};

const buses = new Map<string, CallBus>();

// 체험 콜만 시뮬레이션한다(데모 c-demo-*·박서준 등 스크립트 행은 mock 엔진이 담당).
export function isMockLiveCall(callId: string): boolean {
  return callId.startsWith('exp-');
}

function getBus(callId: string): CallBus {
  let bus = buses.get(callId);
  if (!bus) {
    bus = {
      handlers: { turn: new Set(), speech: new Set(), strategy: new Set(), compliance: new Set() },
      started: false,
      timers: [],
    };
    buses.set(callId, bus);
  }
  return bus;
}

/** 채널 구독. 첫 구독 시 1회 시뮬레이션을 시작한다. 반환값으로 구독 해제. */
export function subscribeMockLive(
  callId: string,
  channel: MockLiveChannel,
  handler: Handler,
): () => void {
  const bus = getBus(callId);
  bus.handlers[channel].add(handler);
  // 핸들러가 붙은 직후 1회 재생 시작(여러 카드가 거의 동시에 구독하므로 마이크로태스크로 지연).
  if (!bus.started) {
    bus.started = true;
    queueMicrotask(() => runScript(callId));
  }
  return () => {
    bus.handlers[channel].delete(handler);
  };
}

function emit(callId: string, channel: MockLiveChannel, payload: unknown): void {
  const bus = buses.get(callId);
  if (!bus) return;
  for (const h of bus.handlers[channel]) h(payload);
}

// ── 스크립트된 라이브 교환 (박서준 대환 시나리오 축약) ──────────────────────
// 고객 "여보세요" → AI 인사. 각 발화에 발화분석/전략/컴플라이언스를 곁들여 3카드를 채운다.
function runScript(callId: string): void {
  const bus = buses.get(callId);
  if (!bus) return;
  const at = (ms: number, fn: () => void) => bus.timers.push(setTimeout(fn, ms));

  // seq 1 — 고객: "여보세요?"
  at(700, () => {
    emit(callId, 'turn', mkTurn(callId, 1, 'customer', '여보세요?'));
  });

  // seq 2 — AI 인사 + 발화분석/전략/컴플라이언스
  at(1900, () => {
    emit(callId, 'turn', mkTurn(callId, 2, 'bot', '안녕하세요, 현대캐피탈 AI 상담원입니다. 박서준 고객님 맞으실까요?'));
  });
  at(2200, () => {
    emit(callId, 'speech', mkSpeech(callId, 2, [
      { text: '현대캐피탈', polarity: 'NEUTRAL', reason: '' },
      { text: '본인확인', polarity: 'PRO', reason: '신뢰 확보 단계 진입' },
    ]));
    emit(callId, 'strategy', mkStrategy(callId, 2, '신뢰 확보 전략', '통화 출처·사유를 먼저 설명해 경계를 낮춘다'));
    emit(callId, 'compliance', mkCompliance(callId, 'approved'));
  });

  // seq 3 — 고객: 대출 거부(위험 신호)
  at(3600, () => {
    emit(callId, 'turn', mkTurn(callId, 3, 'customer', '네 맞는데요. 근데 대출 전화면 안 받아요.'));
    emit(callId, 'speech', mkSpeech(callId, 3, [
      { text: '대출', polarity: 'CONS', reason: '거부 신호' },
      { text: '안', polarity: 'CONS', reason: '거부 신호' },
      { text: '받아요', polarity: 'CONS', reason: '거부 신호' },
    ]));
    emit(callId, 'strategy', mkStrategy(callId, 3, '공감 후 전환 전략', '우려를 먼저 인정한 뒤 부담 낮은 다음 행동으로 연결한다'));
  });
}

// ── payload 빌더 ──────────────────────────────────────────────────────────────
function mkTurn(callId: string, seq: number, speaker: Turn['speaker'], text: string): Turn {
  return { callId, seq, speaker, text, audioUrl: null };
}

function mkSpeech(callId: string, turnSeq: number, tokens: SpeechAnalysis['tokens']): SpeechAnalysis {
  return { callId, turnSeq, tokens };
}

function mkStrategy(callId: string, turnSeq: number, headline: string, rationale: string): StrategyUpdate {
  return { callId, turnSeq, headline, rationale };
}

function mkCompliance(callId: string, phase: ComplianceState['phase']): ComplianceState {
  return {
    callId,
    phase,
    draft: '본인 확인 후 비교 안내를 진행하겠습니다.',
    violations: [],
    checks: [
      { law: '금융소비자보호법', desc: '설명의무', flagged: false },
      { law: '개인정보보호법', desc: '수집·이용 동의', flagged: false },
      { law: '신용정보법', desc: '신용정보 활용', flagged: false },
      { law: '표현 리스크', desc: '과장·단정 표현', flagged: false },
    ],
    violatedPolicies: [],
    final: [{ text: '본인 확인 후 비교 안내를 진행하겠습니다.' }],
  };
}

/** 테스트 정리용 — 모든 버스/타이머 리셋. */
export function _resetMockLive(): void {
  for (const bus of buses.values()) bus.timers.forEach(clearTimeout);
  buses.clear();
}
