// dfnDenoise — 마이크 MediaStream을 DeepFilterNet3(WASM)으로 실시간 denoise 해
// "깨끗한 MediaStream"을 돌려준다. 오디오 흐름: 마이크 → (이 모듈) → Silero VAD → STT.
//
// 왜 VAD 앞단인가: 잡음을 먼저 제거하면 VAD가 발화 경계를 더 정확히 잡고, STT 입력
// 품질도 올라간다(denoise→detect, 신호처리 정석 순서). DeepFilterNet은
// deepfilter-standalone(WASM)로 브라우저 로컬에서 돌아 서버 왕복이 없다.
//
// 구현: DFN3은 48kHz mono에서 동작한다. AudioContext를 48kHz로 열고 ScriptProcessorNode
// 로 입력 프레임을 받아 processStreaming(상태 유지 스트리밍)으로 denoise한 뒤, 그 출력을
// MediaStreamAudioDestinationNode로 흘려 새 MediaStream을 만든다. DFN 출력은 프레임
// 단위(가변 길이)라 링 버퍼로 고정 크기(4096) 출력 버퍼와 맞춘다(언더런 시 무음 패딩).
// ScriptProcessorNode는 deprecated지만 기존 pcmCapture와 동일하게 데모 호환성 우선.
//
// best-effort: 모델 로드 실패/미지원 시 원본 스트림을 그대로 돌려준다(denoise 없이 VAD는
// 계속 동작). DFN 장애가 라이브 상담을 끊지 않게 한다.

// 자체 호스팅 에셋 경로(public/vad/df/). deepfilter-standalone이 ${cdnUrl}/pkg/df_bg.wasm
// 와 ${cdnUrl}/models/DeepFilterNet3_onnx.tar.gz 를 fetch한다 — 그 레이아웃에 맞춰 둔다.
// 기본 CDN(third-party)을 쓰지 않고 우리 오리진에서 받아 부스 데모의 신뢰성·프라이버시를 지킨다.
const DFN_ASSET_PATH = '/vad/df';
const DFN_SAMPLE_RATE = 48000;

export type DfnDenoiseHandle = {
  /** denoise된 스트림(실패 시 원본 스트림). Silero VAD에 이 스트림을 넘긴다. */
  stream: MediaStream;
  /** denoise가 실제로 적용됐는지(false면 원본 패스스루). */
  enhanced: boolean;
  /** 정리(노드 disconnect + context close). 멱등. 원본 마이크 트랙은 호출측이 관리. */
  stop: () => void;
};

export type DfnDenoiseOptions = {
  /**
   * 노이즈 억제 강도(dB, 0~100). 높을수록 공격적. 기본 50.
   * 너무 높이면 작은 목소리까지 깎여 VAD가 발화를 놓칠 수 있어 중간값을 쓴다.
   */
  attenuationLimit?: number;
  /** 디버그 로그 훅(선택) — 초기화/프레임 처리 시간 관찰용. */
  onDebug?: (msg: string) => void;
};

/**
 * 마이크 스트림을 DFN으로 denoise한 새 MediaStream을 만든다.
 * 모델 로드(WASM/모델 fetch)가 비동기라 Promise를 반환한다. 실패해도 reject하지 않고
 * 원본 스트림을 담은 handle(enhanced:false)을 돌려준다 — 호출측은 항상 stream을 쓴다.
 */
export async function startDfnDenoise(
  stream: MediaStream,
  options: DfnDenoiseOptions = {},
): Promise<DfnDenoiseHandle> {
  const onDebug = options.onDebug;
  // 원본 패스스루 handle — 어떤 실패 경로든 이걸 돌려줘 VAD가 계속 동작하게 한다.
  const passthrough: DfnDenoiseHandle = { stream, enhanced: false, stop: () => {} };

  type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext };
  const Ctx = window.AudioContext || (window as WindowWithWebkit).webkitAudioContext;
  if (!Ctx) return passthrough;

  let denoiser: import('deepfilter-standalone').StandaloneDeepFilter | null = null;
  try {
    // 동적 import — WASM 의존이라 SSR 번들에서 평가되면 안 된다(클라이언트 호출 시점 로드).
    const { StandaloneDeepFilter } = await import('deepfilter-standalone');
    denoiser = new StandaloneDeepFilter({
      cdnUrl: DFN_ASSET_PATH,
      attenuationLimit: options.attenuationLimit ?? 50,
    });
    await denoiser.initialize();
    denoiser.startStreaming();
    onDebug?.('[dfn] 모델 로드 완료, 스트리밍 시작');
  } catch (err) {
    // 모델 로드/초기화 실패 — 원본 패스스루로 강등(VAD 무중단).
    onDebug?.(`[dfn] 초기화 실패 — 원본 스트림 패스스루: ${String(err)}`);
    return passthrough;
  }

  // DFN은 48kHz에서 동작 — 컨텍스트를 48kHz로 명시 요청. 미지원 브라우저는 다른 레이트로
  // 떨어질 수 있는데, 그 경우 denoise 품질이 깨지므로 패스스루로 강등한다.
  let ctx: AudioContext;
  try {
    ctx = new Ctx({ sampleRate: DFN_SAMPLE_RATE });
  } catch {
    ctx = new Ctx();
  }
  if (ctx.sampleRate !== DFN_SAMPLE_RATE) {
    onDebug?.(`[dfn] 48kHz 컨텍스트 불가(${ctx.sampleRate}Hz) — 원본 패스스루`);
    void ctx.close().catch(() => {});
    return passthrough;
  }
  if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
    void ctx.resume().catch(() => {});
  }

  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const destination = ctx.createMediaStreamDestination();

  // 링 버퍼: DFN 출력(프레임 단위 가변 길이)을 고정 4096 출력 버퍼와 맞춘다.
  // 넉넉히 잡아 언더런(무음 패딩)을 줄인다(~0.5s @48k).
  const RING = DFN_SAMPLE_RATE; // 1초분
  const ring = new Float32Array(RING);
  let writePos = 0;
  let readPos = 0;
  let available = 0;

  const pushToRing = (samples: Float32Array) => {
    for (let i = 0; i < samples.length; i++) {
      ring[writePos] = samples[i];
      writePos = (writePos + 1) % RING;
      if (available < RING) {
        available++;
      } else {
        // 오버런(소비가 못 따라옴) — 가장 오래된 샘플을 덮어쓰며 read도 민다.
        readPos = (readPos + 1) % RING;
      }
    }
  };

  let stopped = false;

  processor.onaudioprocess = (e: AudioProcessingEvent) => {
    if (stopped) return;
    const input = e.inputBuffer.getChannelData(0);
    const out = e.outputBuffer.getChannelData(0);
    try {
      // 입력 프레임을 DFN에 흘리고(상태 유지), 나온 denoise 샘플을 링에 적재.
      // processStreaming은 입력 복사본을 받는 게 안전(내부에서 누적·slice).
      const denoised = denoiser!.processStreaming(Float32Array.from(input));
      if (denoised.length > 0) pushToRing(denoised);
    } catch {
      // 프레임 처리 실패 — 이 프레임은 원본을 그대로 통과시켜 끊김을 막는다.
      pushToRing(Float32Array.from(input));
    }
    // 출력 버퍼를 링에서 채운다(부족하면 무음 패딩 — 초기 frameLength 지연 흡수).
    for (let i = 0; i < out.length; i++) {
      if (available > 0) {
        out[i] = ring[readPos];
        readPos = (readPos + 1) % RING;
        available--;
      } else {
        out[i] = 0;
      }
    }
  };

  source.connect(processor);
  processor.connect(destination);

  return {
    stream: destination.stream,
    enhanced: true,
    stop: () => {
      if (stopped) return;
      stopped = true;
      try { processor.disconnect(); } catch { /* noop */ }
      try { source.disconnect(); } catch { /* noop */ }
      try { denoiser?.destroy(); } catch { /* noop */ }
      void ctx.close().catch(() => {});
    },
  };
}
