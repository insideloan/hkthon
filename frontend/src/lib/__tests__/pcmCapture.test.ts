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

class FakeAudioContext {
  sampleRate = 16000;
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
