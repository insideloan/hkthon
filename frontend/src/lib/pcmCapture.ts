// pcmCapture — 마이크 MediaStream → 16kHz mono PCM(base64) 청크 캡처.
//
// 백엔드 STT(amazon-transcribe)는 16kHz mono PCM(little-endian Int16)을 기대한다
// (stt/transcribe_stt.py: media_encoding="pcm", sample_rate_hz=16000). 브라우저
// AudioContext로 마이크를 받아 Int16로 다운샘플·인코딩한 뒤 ~интервал마다 base64
// 청크를 콜백으로 흘린다. ScriptProcessorNode는 deprecated지만 데모 범위에서 가장
// 호환성이 넓다(AudioWorklet 대비 셋업 단순).

const TARGET_RATE = 16000;

/** Float32 [-1,1] 샘플을 little-endian Int16 PCM bytes로 변환. */
function floatToPcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** 입력 샘플레이트 → 16kHz 선형 다운샘플(데모 품질로 충분). */
function downsample(samples: Float32Array, inRate: number): Float32Array {
  if (inRate === TARGET_RATE) return samples;
  const ratio = inRate / TARGET_RATE;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = samples[Math.floor(i * ratio)];
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export type PcmCaptureHandle = {
  /** 캡처 중지 + 리소스 해제. 멱등. */
  stop: () => void;
};

/**
 * MediaStream에서 PCM 청크를 캡처해 ~chunkMs 간격으로 onChunk(base64)로 전달한다.
 * 반환된 handle.stop()으로 정지.
 */
export function startPcmCapture(
  stream: MediaStream,
  onChunk: (base64: string) => void,
  options: { chunkMs?: number } = {},
): PcmCaptureHandle {
  const chunkMs = options.chunkMs ?? 2500;

  type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext };
  const Ctx = window.AudioContext || (window as WindowWithWebkit).webkitAudioContext;
  if (!Ctx) {
    // AudioContext 미지원 — 캡처 불가, no-op handle.
    return { stop: () => {} };
  }

  const ctx = new Ctx();
  const source = ctx.createMediaStreamSource(stream);
  // 4096 프레임 버퍼, mono in/out.
  const processor = ctx.createScriptProcessor(4096, 1, 1);

  let buffer: number[] = [];
  let lastFlush = (typeof performance !== 'undefined' ? performance.now() : 0);
  let stopped = false;

  const flush = () => {
    if (buffer.length === 0) return;
    const down = downsample(Float32Array.from(buffer), ctx.sampleRate);
    buffer = [];
    const pcm = floatToPcm16(down);
    onChunk(bytesToBase64(pcm));
  };

  processor.onaudioprocess = (e: AudioProcessingEvent) => {
    if (stopped) return;
    const input = e.inputBuffer.getChannelData(0);
    for (let i = 0; i < input.length; i++) buffer.push(input[i]);
    const now = typeof performance !== 'undefined' ? performance.now() : lastFlush + chunkMs;
    if (now - lastFlush >= chunkMs) {
      lastFlush = now;
      flush();
    }
  };

  source.connect(processor);
  processor.connect(ctx.destination);

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      flush(); // 마지막 잔여 청크 전송
      try { processor.disconnect(); } catch { /* noop */ }
      try { source.disconnect(); } catch { /* noop */ }
      void ctx.close().catch(() => {});
    },
  };
}
