// pcmCapture VAD endpointing 단위 테스트.
//
// jsdom엔 Web Audio가 없으므로 AudioContext/ScriptProcessorNode를 가짜로 주입해
// onaudioprocess 콜백을 직접 구동, "발화→침묵→flush" 종료 판단을 검증한다.
// 핵심: 한 청크 = 한 발화(2.5초 고정 칼질 제거). 발화 전 침묵은 청크를 안 만든다.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startPcmCapture } from '../pcmCapture';

// ── 가짜 Web Audio ────────────────────────────────────────────────────────────
let processor: { onaudioprocess: ((e: unknown) => void) | null; connect: () => void; disconnect: () => void };
let nowMs = 0;
let resumeSpy: ReturnType<typeof vi.fn>;

class FakeAudioContext {
  sampleRate = 16000;
  state = 'suspended';
  resume = resumeSpy;
  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }
  createScriptProcessor() {
    processor = { onaudioprocess: null, connect: vi.fn(), disconnect: vi.fn() };
    return processor;
  }
  close() {
    return Promise.resolve();
  }
  get destination() {
    return {};
  }
}

/** 음량 level(0~1)로 채운 4096 프레임짜리 가짜 onaudioprocess 이벤트를 흘린다. */
function feed(level: number, frames = 4096) {
  const data = new Float32Array(frames);
  data.fill(level); // 상수 진폭 → RMS = |level|
  processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => data } });
}

beforeEach(() => {
  nowMs = 0;
  resumeSpy = vi.fn(() => Promise.resolve());
  vi.stubGlobal('AudioContext', FakeAudioContext as unknown as typeof AudioContext);
  // performance.now()를 우리가 제어 — 침묵 타이머를 결정적으로 검증.
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  vi.stubGlobal('btoa', (s: string) => Buffer.from(s, 'binary').toString('base64'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('startPcmCapture VAD endpointing', () => {
  it('발화 전 침묵에는 청크를 만들지 않는다', () => {
    const onChunk = vi.fn();
    const h = startPcmCapture({} as MediaStream, onChunk, { silenceMs: 800 });
    feed(0.0); // 무음
    nowMs += 2000;
    feed(0.0);
    expect(onChunk).not.toHaveBeenCalled();
    h.stop();
    expect(onChunk).not.toHaveBeenCalled(); // 잔여 버퍼도 없음
  });

  it('함수형 vadThreshold: 매 프레임 현재값을 읽어 실시간 반영(슬라이더 연동)', () => {
    let threshold = 0.1; // 처음엔 둔감 — 0.05 발화를 무시
    const onChunk = vi.fn();
    const h = startPcmCapture({} as MediaStream, onChunk, {
      vadThreshold: () => threshold, silenceMs: 800,
    });
    feed(0.05); // 0.05 < 0.1 → 발화로 안 잡힘
    nowMs += 900; feed(0.0);
    expect(onChunk).not.toHaveBeenCalled();
    // 슬라이더를 낮춤 → 같은 0.05 발화가 이제 잡힌다(재시작 없이).
    threshold = 0.02;
    feed(0.05); nowMs += 900; feed(0.0);
    expect(onChunk).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it('발화 후 침묵 ≥ silenceMs면 한 발화로 flush한다', () => {
    const onChunk = vi.fn();
    const h = startPcmCapture({} as MediaStream, onChunk, { vadThreshold: 0.01, silenceMs: 800 });
    // 말하는 중 (임계값 초과)
    feed(0.2);
    nowMs += 100;
    feed(0.2);
    expect(onChunk).not.toHaveBeenCalled(); // 아직 말하는 중 → flush 안 함
    // 침묵 시작
    nowMs += 300;
    feed(0.0); // 마지막 음성 후 300ms — 아직 silenceMs 미만
    expect(onChunk).not.toHaveBeenCalled();
    nowMs += 600;
    feed(0.0); // 누적 900ms 침묵 ≥ 800 → flush
    expect(onChunk).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it('suspended AudioContext를 시작 시 resume한다(첫 발화 지연 워밍업)', () => {
    const h = startPcmCapture({} as MediaStream, vi.fn());
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it('에코 게이팅: 봇 발화 중에는 임계값을 suppressGain 배로 올려 에코를 무시', () => {
    let suppressed = true;
    const onChunk = vi.fn();
    const h = startPcmCapture({} as MediaStream, onChunk, {
      vadThreshold: 0.05, silenceMs: 800, suppressGain: 4, isSuppressed: () => suppressed,
    });
    // 봇 발화 중(suppressed): 0.1 에코는 0.05*4=0.2 미만 → 발화로 안 잡힘.
    feed(0.1); nowMs += 900; feed(0.0);
    expect(onChunk).not.toHaveBeenCalled();
    // 봇 발화 종료(suppressed=false): 같은 0.1이 임계값 0.05 초과 → 발화로 잡힘.
    suppressed = false;
    feed(0.1); nowMs += 900; feed(0.0);
    expect(onChunk).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it('에코 게이팅: 큰 목소리(suppressGain 임계값 초과)는 봇 발화 중에도 barge-in 통과', () => {
    const onChunk = vi.fn();
    const h = startPcmCapture({} as MediaStream, onChunk, {
      vadThreshold: 0.05, silenceMs: 800, suppressGain: 4, isSuppressed: () => true,
    });
    // 0.3 > 0.05*4=0.2 → 봇 발화 중이어도 진짜 barge-in으로 통과.
    feed(0.3); nowMs += 900; feed(0.0);
    expect(onChunk).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it('에코 게이팅: 이미 발화 중이면 게이팅하지 않아 말꼬리가 끊기지 않는다', () => {
    let suppressed = false;
    const onChunk = vi.fn();
    const h = startPcmCapture({} as MediaStream, onChunk, {
      vadThreshold: 0.05, silenceMs: 800, suppressGain: 4, isSuppressed: () => suppressed,
    });
    feed(0.1); // 발화 시작(0.1 > 0.05)
    // 발화 도중 봇 클립이 시작돼 suppressed=true가 되어도, 이미 speaking이라 게이팅 제외.
    suppressed = true;
    nowMs += 100; feed(0.1); // 말꼬리 계속 잡힘
    nowMs += 900; feed(0.0); // 종료 → flush
    expect(onChunk).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it('두 발화는 두 개의 청크로 분리된다', () => {
    const onChunk = vi.fn();
    const h = startPcmCapture({} as MediaStream, onChunk, { vadThreshold: 0.01, silenceMs: 800 });
    // 발화 1
    feed(0.2); nowMs += 100; feed(0.2);
    nowMs += 900; feed(0.0); // 종료 → flush 1
    expect(onChunk).toHaveBeenCalledTimes(1);
    // 발화 2
    nowMs += 500; feed(0.2); nowMs += 100; feed(0.2);
    nowMs += 900; feed(0.0); // 종료 → flush 2
    expect(onChunk).toHaveBeenCalledTimes(2);
    h.stop();
  });

  it('maxUtteranceMs 초과 시 침묵 없이도 강제 flush(끊김 방지)', () => {
    const onChunk = vi.fn();
    const h = startPcmCapture({} as MediaStream, onChunk, {
      vadThreshold: 0.01, silenceMs: 800, maxUtteranceMs: 1000,
    });
    feed(0.2);            // 발화 시작 (t=0)
    nowMs += 1100;        // 계속 말하는 중, 1.1s 경과
    feed(0.2);            // maxUtteranceMs(1000) 초과 → 강제 flush
    expect(onChunk).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it('stop()은 진행 중이던 발화의 잔여분을 flush한다', () => {
    const onChunk = vi.fn();
    const h = startPcmCapture({} as MediaStream, onChunk, { vadThreshold: 0.01, silenceMs: 800 });
    feed(0.2); // 말하는 중 (침묵 도달 전)
    expect(onChunk).not.toHaveBeenCalled();
    h.stop();
    expect(onChunk).toHaveBeenCalledTimes(1);
  });

  it('onSpeechStart: 발화 시작(침묵→음성 전환)마다 1회 호출(barge-in 트리거)', () => {
    const onSpeechStart = vi.fn();
    const h = startPcmCapture({} as MediaStream, vi.fn(), {
      vadThreshold: 0.01, silenceMs: 800, onSpeechStart,
    });
    feed(0.2);            // 발화 시작 → 1회
    nowMs += 100; feed(0.2); // 발화 지속 → 추가 호출 없음
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    nowMs += 900; feed(0.0); // 침묵 → flush(발화 종료)
    nowMs += 500; feed(0.2); // 새 발화 시작 → 2회째
    expect(onSpeechStart).toHaveBeenCalledTimes(2);
    h.stop();
  });

  it('onDebug 튜닝 훅: frame/speech-start/flush 이벤트와 reason을 보고한다', () => {
    const events: string[] = [];
    const h = startPcmCapture({} as MediaStream, vi.fn(), {
      vadThreshold: 0.01, silenceMs: 800,
      onDebug: (ev) => events.push(ev.type === 'flush' ? `flush:${ev.reason}` : ev.type),
    });
    feed(0.2);            // frame + speech-start
    nowMs += 900; feed(0.0); // frame + flush:silence
    expect(events).toContain('frame');
    expect(events).toContain('speech-start');
    expect(events).toContain('flush:silence');
    // frame 이벤트는 RMS·threshold를 실어 튜닝에 쓸 수 있어야 한다.
    const frames: number[] = [];
    startPcmCapture({} as MediaStream, vi.fn(), {
      vadThreshold: 0.05,
      onDebug: (ev) => { if (ev.type === 'frame') frames.push(ev.rms); },
    });
    feed(0.2);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0]).toBeCloseTo(0.2, 2); // 상수 진폭 0.2 → RMS ≈ 0.2
    h.stop();
  });
});
