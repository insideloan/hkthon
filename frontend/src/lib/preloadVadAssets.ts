// preloadVadAssets — 라이브 상담에 필요한 무거운 VAD/DNF 에셋(~35MB)을 랜딩 시점에
// 미리 받아 브라우저 HTTP 캐시를 데운다. LiveSession은 마이크 시작 순간에야 이 에셋들을
// 동적 fetch하는데(sileroCapture/dfnDenoise), 그때 처음 내려받으면 "상담 시작" 직후
// 수~수십 초의 빈 화면/지연이 생긴다. 랜딩에서 idle 시간에 미리 당겨두면 통화 시작이
// 즉각적이다(에셋이 이미 캐시에 있으므로 vad-web/deepfilter가 재요청해도 디스크 캐시 적중).
//
// best-effort: 실패(오프라인·차단)해도 무시한다 — preload는 어디까지나 최적화이고,
// 실제 로드는 LiveSession 경로가 책임진다. PC(/)·모바일(/m) 양쪽 랜딩에서 호출한다.

// preload 대상 — sileroCapture.ts(VAD_ASSET_PATH '/vad/', model 'v5')와
// dfnDenoise.ts(DFN_ASSET_PATH '/vad/df')가 런타임에 fetch하는 파일들과 정확히 일치해야
// 캐시가 적중한다. 경로/파일명을 바꾸면 그쪽 모듈과 함께 갱신할 것.
const VAD_ASSETS: readonly string[] = [
  // Silero VAD — onnxruntime-web(WASM) + v5 ONNX 모델 + 오디오 워클릿.
  '/vad/silero_vad_v5.onnx',
  '/vad/ort-wasm-simd-threaded.wasm',
  '/vad/ort-wasm-simd-threaded.mjs',
  '/vad/vad.worklet.bundle.min.js',
  // DeepFilterNet3 denoise — WASM + 모델 아카이브.
  '/vad/df/pkg/df_bg.wasm',
  '/vad/df/models/DeepFilterNet3_onnx.tar.gz',
];

// fetch에 priority 힌트를 주기 위한 확장 타입(Chrome 계열 지원, 미지원 브라우저는 무시).
type RequestInitWithPriority = RequestInit & { priority?: 'high' | 'low' | 'auto' };

// 모듈 단위 멱등 가드 — 한 세션에서 여러 번 호출돼도(스토어 재마운트 등) 한 번만 받는다.
let started = false;

/**
 * VAD/DNF 정적 에셋을 백그라운드로 미리 받아 HTTP 캐시를 데운다. 멱등(최초 1회만 실행).
 * 브라우저가 아니면 no-op. 각 요청은 저우선순위로, 랜딩 렌더링을 방해하지 않는다.
 */
export function preloadVadAssets(): void {
  if (typeof window === 'undefined' || started) return;
  started = true;

  // 무거운 vad-web/deepfilter JS 청크도 미리 끌어와 둔다(import만으로 모델은 안 받음 —
  // 가벼운 코드 prefetch). 실패는 무시. 실제 초기화는 LiveSession 시점에 일어난다.
  void import('@ricky0123/vad-web').catch(() => {});
  void import('deepfilter-standalone').catch(() => {});

  for (const url of VAD_ASSETS) {
    // 캐시 가능한 정적 에셋이라 일반 fetch가 디스크 캐시를 채운다(later 재fetch가 적중).
    // 본문은 즉시 버린다 — 목적은 다운로드/캐시 워밍이지 메모리 보존이 아니다.
    void fetch(url, { priority: 'low' } as RequestInitWithPriority)
      .then((res) => res.arrayBuffer())
      .catch(() => {});
  }
}
