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

/** VAD 튜닝/디버그 이벤트. onDebug로 받아 콘솔 관찰 → vadThreshold/silenceMs 조정. */
export type PcmVadEvent =
  | { type: 'frame'; rms: number; speaking: boolean; threshold: number }
  | { type: 'speech-start' }
  | { type: 'flush'; reason: 'silence' | 'max-utterance' | 'stop'; durationMs: number; samples: number };

export type PcmCaptureOptions = {
  /** 발화로 간주할 프레임 RMS 임계값(0~1). 이 값 초과면 '말하는 중'. */
  vadThreshold?: number;
  /** 발화 후 이만큼(ms) 연속 침묵하면 발화 종료로 보고 flush(=한 발화). */
  silenceMs?: number;
  /** 한 발화가 이 길이(ms)를 넘으면 침묵 없이도 강제 flush(끊김 방지 안전장치). */
  maxUtteranceMs?: number;
  /**
   * 튜닝용 디버그 훅(선택). 프레임별 RMS·발화 시작·flush 사유를 흘린다.
   * 실제 마이크로 말해보며 vadThreshold/silenceMs를 맞출 때만 쓴다(프로덕션 미사용).
   * frame 이벤트는 과다하므로 onDebug 내부에서 샘플링/throttle 권장.
   */
  onDebug?: (ev: PcmVadEvent) => void;
};

/** 프레임 RMS(평균 제곱근 음량) 계산 — 무음 게이트/발화 감지에 사용. */
function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (samples.length || 1));
}

/**
 * MediaStream에서 PCM을 캡처하되, 고정 간격이 아니라 **발화 단위(endpointing)** 로
 * onChunk(base64)를 호출한다. 음량(RMS)을 모니터링해 '말하는 중'에만 버퍼에 쌓고,
 * 발화 후 silenceMs 만큼 침묵이 이어지면 그 발화 전체를 한 청크로 flush한다.
 * (한 청크 = 한 발화 = 백엔드 한 턴. 2.5초 고정 칼질로 문장이 잘리던 문제 해소.)
 * 반환된 handle.stop()으로 정지.
 */
export function startPcmCapture(
  stream: MediaStream,
  onChunk: (base64: string) => void,
  options: PcmCaptureOptions = {},
): PcmCaptureHandle {
  const vadThreshold = options.vadThreshold ?? 0.012;
  const silenceMs = options.silenceMs ?? 800;
  const maxUtteranceMs = options.maxUtteranceMs ?? 15000;
  const onDebug = options.onDebug;

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

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  let buffer: number[] = [];
  let speaking = false;          // 현재 발화가 진행 중인지
  let lastVoiceAt = 0;           // 마지막으로 음성을 감지한 시각
  let utteranceStart = 0;        // 현재 발화 시작 시각
  let stopped = false;

  const flush = (reason: 'silence' | 'max-utterance' | 'stop') => {
    speaking = false;
    if (buffer.length === 0) return;
    const samples = buffer.length;
    const down = downsample(Float32Array.from(buffer), ctx.sampleRate);
    buffer = [];
    const pcm = floatToPcm16(down);
    onDebug?.({ type: 'flush', reason, durationMs: now() - utteranceStart, samples });
    onChunk(bytesToBase64(pcm));
  };

  processor.onaudioprocess = (e: AudioProcessingEvent) => {
    if (stopped) return;
    const input = e.inputBuffer.getChannelData(0);
    const level = rms(input);
    const t = now();
    onDebug?.({ type: 'frame', rms: level, speaking, threshold: vadThreshold });

    if (level >= vadThreshold) {
      // 음성 감지 — 발화 시작/지속. 버퍼에 누적.
      if (!speaking) {
        speaking = true;
        utteranceStart = t;
        onDebug?.({ type: 'speech-start' });
      }
      lastVoiceAt = t;
      for (let i = 0; i < input.length; i++) buffer.push(input[i]);
      // 너무 긴 발화는 강제로 끊어 한 턴이 무한정 커지지 않게(안전장치).
      if (t - utteranceStart >= maxUtteranceMs) flush('max-utterance');
      return;
    }

    // 침묵 프레임: 발화 중이었다면 끝물 음성을 잠깐 더 담되(자연스러운 꼬리),
    // silenceMs 이상 침묵이 지속되면 발화 종료로 보고 flush(=한 발화 완성).
    if (speaking) {
      for (let i = 0; i < input.length; i++) buffer.push(input[i]);
      if (t - lastVoiceAt >= silenceMs) flush('silence');
    }
    // 발화 시작 전 침묵은 무시(빈/잡음 청크를 백엔드로 안 보냄).
  };

  source.connect(processor);
  processor.connect(ctx.destination);

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      flush('stop'); // 진행 중이던 발화의 잔여분 전송
      try { processor.disconnect(); } catch { /* noop */ }
      try { source.disconnect(); } catch { /* noop */ }
      void ctx.close().catch(() => {});
    },
  };
}
