// sileroCapture — 마이크 MediaStream → Silero VAD(@ricky0123/vad-web) 발화 단위 PCM 캡처.
//
// 기존 pcmCapture(RMS 임계값 게이트)를 대체한다. RMS는 음량만 보기 때문에 잡음·에코를
// 발화로 자주 오인하고, 임계값을 손으로 깎아야 했다. Silero VAD는 ONNX 모델로 "사람
// 목소리"를 직접 판별해 첫 마디 누락/말끝 잘림이 적다. 모델은 onnxruntime-web(WASM)로
// 브라우저 로컬에서 돌아 서버 왕복이 없다(지연 수 ms).
//
// 인터페이스는 startPcmCapture와 동일하게 유지한다(LiveSession 드롭인):
//   - onChunk(base64): 발화 1건이 끝나면 16kHz mono PCM16(little-endian) base64 1개.
//     백엔드 STT(amazon-transcribe, media_encoding="pcm", sample_rate_hz=16000)가
//     기대하는 포맷 그대로다. vad-web의 onSpeechEnd는 이미 16kHz Float32라 다운샘플 불필요.
//   - onSpeechStart / onSpeechEnd: barge-in·"음성 인식 중" UI 훅(기존과 동일 의미).
//   - isSuppressed: 봇 발화 중 에코 게이팅(아래 주석 참고).
//
// WASM/ONNX 에셋은 public/vad/ 에 호스팅한다(baseAssetPath/onnxWASMBasePath). Next는
// public/을 정적 루트로 서빙하므로 런타임에 /vad/* 로 로드된다.

import { floatToPcm16, bytesToBase64, type PcmCaptureHandle, type PcmVadEvent } from './pcmCapture';

export type { PcmCaptureHandle, PcmVadEvent } from './pcmCapture';

/** Silero 캡처 옵션 — pcmCapture와 의미가 겹치는 훅은 이름/역할을 그대로 맞춘다. */
export type SileroCaptureOptions = {
  /**
   * 발화 시작 임계값(0~1). Silero 모델의 speech 확률이 이 값을 넘으면 발화로 본다.
   * 함수로 주면 매 인스턴스 생성 시 현재 값을 읽는다(슬라이더 연동). 미지정 시 0.5.
   * RMS vadThreshold(0~0.2 음량)와 의미가 다르다 — 여긴 "사람 목소리일 확률"이다.
   */
  positiveSpeechThreshold?: number | (() => number);
  /**
   * 발화 종료(무음) 임계값. 확률이 이 값 아래로 떨어지면 종료 후보. Silero 권장값은
   * positive보다 0.15 낮게. 미지정 시 positive - 0.15(하한 0.05).
   */
  negativeSpeechThreshold?: number;
  /**
   * 발화 종료로 보기 전 유예(ms). 사용자가 숨 고르며 잠깐 멈춰도 한 발화로 잇는다.
   * 너무 짧으면 말끝이 잘려 여러 청크로 쪼개진다. 미지정 시 800ms.
   */
  redemptionMs?: number;
  /**
   * 발화 앞단에 덧붙일 패딩(ms). "안녕하세요"의 "안"이 잘리지 않게 감지 시점보다
   * 앞선 오디오를 포함한다. 미지정 시 300ms.
   */
  preSpeechPadMs?: number;
  /**
   * 이보다 짧은 발화는 잡음으로 보고 버린다(onSpeechEnd 대신 misfire). 미지정 시 250ms.
   */
  minSpeechMs?: number;
  /** 새 발화 시작 시 1회. barge-in(봇 음성 중단) + "음성 인식 중" 표시. */
  onSpeechStart?: () => void;
  /** 발화 종료(또는 misfire) 시 1회. "음성 인식 중" 표시 내림. */
  onSpeechEnd?: () => void;
  /**
   * 에코 게이팅: 봇 음성이 스피커로 나가는 중인지 매 발화 시작 시 조회한다(true=재생 중).
   * RMS 버전은 매 프레임 임계값을 올렸지만, Silero는 모델이 봇 합성음을 사람 목소리로
   * 잘 오인하지 않으므로, 여기선 "봇 발화 중 + 짧은 발화"를 misfire로 흘려보내는 식의
   * 가벼운 게이팅만 한다(진짜 barge-in은 길고 또렷해 통과). 미지정 시 게이팅 없음.
   */
  isSuppressed?: () => boolean;
  /** 튜닝/디버그 훅 — pcmCapture와 동일 이벤트 형태(speech-start/flush)로 흘린다. */
  onDebug?: (ev: PcmVadEvent) => void;
};

// vad-web 에셋 위치(public/vad/). 슬래시 포함 — onnxruntime-web가 이 경로 뒤에 파일명을 붙인다.
const VAD_ASSET_PATH = '/vad/';

/**
 * MediaStream에서 Silero VAD로 발화 단위 PCM을 캡처해 onChunk(base64)로 흘린다.
 * 모델 로드(WASM/ONNX fetch)가 비동기라 startPcmCapture와 달리 Promise를 반환한다 —
 * 호출측은 await하거나 then으로 handle을 받는다. 로드 실패 시 reject.
 */
export async function startSileroCapture(
  stream: MediaStream,
  onChunk: (base64: string) => void,
  options: SileroCaptureOptions = {},
): Promise<PcmCaptureHandle> {
  // 동적 import — vad-web은 브라우저 전용(window/AudioContext 의존)이라 SSR 번들에서
  // 평가되면 안 된다. 클라이언트에서 호출되는 이 시점에 로드한다.
  const { MicVAD } = await import('@ricky0123/vad-web');

  const posOpt = options.positiveSpeechThreshold ?? 0.5;
  const positive = typeof posOpt === 'function' ? posOpt() : posOpt;
  const negative = options.negativeSpeechThreshold ?? Math.max(0.05, positive - 0.15);
  const onSpeechStart = options.onSpeechStart;
  const onSpeechEnd = options.onSpeechEnd;
  const isSuppressed = options.isSuppressed;
  const onDebug = options.onDebug;

  let stopped = false;
  let speechStartAt = 0;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const vad = await MicVAD.new({
    // 이미 권한을 받은 MediaStream을 그대로 쓴다 — vad-web이 다시 getUserMedia 하지 않게
    // getStream으로 주입한다(권한 재요청·중복 트랙 방지). pause/resume도 no-op로 둬
    // 스트림 생명주기는 호출측(LiveSession)이 관리하게 한다.
    getStream: async () => stream,
    pauseStream: async () => {},
    resumeStream: async () => stream,
    startOnLoad: false,
    model: 'v5',
    baseAssetPath: VAD_ASSET_PATH,
    onnxWASMBasePath: VAD_ASSET_PATH,
    positiveSpeechThreshold: positive,
    negativeSpeechThreshold: negative,
    redemptionMs: options.redemptionMs ?? 800,
    preSpeechPadMs: options.preSpeechPadMs ?? 300,
    minSpeechMs: options.minSpeechMs ?? 250,
    onSpeechStart: () => {
      if (stopped) return;
      speechStartAt = now();
      onDebug?.({ type: 'speech-start' });
      onSpeechStart?.(); // barge-in: 발화 시작 즉시 봇 음성 중단
    },
    onSpeechEnd: (audio: Float32Array) => {
      if (stopped) return;
      onSpeechEnd?.();
      // 에코 게이팅: 봇 발화 중에 끝난 짧은 발화는 되먹임 에코일 가능성이 커 드롭한다.
      // 진짜 barge-in은 minSpeechMs를 충분히 넘는 또렷한 발화라 통과한다(여기선 600ms 기준).
      if (isSuppressed?.() === true && now() - speechStartAt < 600) {
        onDebug?.({ type: 'flush', reason: 'silence', durationMs: now() - speechStartAt, samples: audio.length });
        return;
      }
      // vad-web의 audio는 16kHz mono Float32(preSpeechPad/redemption 적용 완료) → PCM16 인코딩만.
      const pcm = floatToPcm16(audio);
      onDebug?.({ type: 'flush', reason: 'silence', durationMs: now() - speechStartAt, samples: audio.length });
      onChunk(bytesToBase64(pcm));
    },
    onVADMisfire: () => {
      if (stopped) return;
      // 너무 짧은 발화(minSpeechMs 미만) — 잡음으로 보고 청크는 안 보내되, 시작 시 켠
      // "음성 인식 중" 표시는 내려야 한다.
      onSpeechEnd?.();
    },
  });

  vad.start();

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      // destroy는 비동기지만 호출측 stop() 규약(동기·멱등)에 맞춰 fire-and-forget.
      // 진행 중이던 발화의 잔여는 버린다(stop은 언마운트 경로라 UI가 사라진다).
      void vad.destroy?.();
    },
  };
}
