// botAudioControl — 봇 TTS 재생을 외부에서 중단(barge-in)하기 위한 공유 제어면.
//
// 봇 음성 재생(useBotAudioPlayback)과 마이크 캡처(LiveSession)는 서로 다른
// 컴포넌트에 산다. 상담원(봇) 음성이 나가는 중에 고객이 다시 말을 시작하면 즉시
// 음성을 끊어야 하는데(barge-in), 캡처 쪽에서 재생 쪽 audio 엘리먼트에 직접 닿을 수
// 없다. 그래서 재생 훅이 자신의 stop 함수를 여기에 등록하고, 캡처가 발화 시작을
// 감지하면 stopBotAudio()로 그 함수를 호출한다.
//
// 한 화면에 라이브 세션은 하나뿐이므로 모듈 단일 등록(singleton)으로 충분하다.

let stopper: (() => void) | null = null;

/** 봇 오디오 재생 훅이 자신의 중단 함수를 등록(언마운트 시 null로 해제). */
export function setBotAudioStopper(fn: (() => void) | null): void {
  stopper = fn;
}

/** 현재 재생 중인 봇 음성을 중단(미등록·미재생이면 no-op). 캡처의 발화 시작에서 호출. */
export function stopBotAudio(): void {
  stopper?.();
}
