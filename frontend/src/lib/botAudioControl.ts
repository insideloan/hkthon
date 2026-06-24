// botAudioControl — 봇 TTS 재생을 외부에서 중단(barge-in)하고, 재생 중인지
// 조회하기 위한 공유 제어면.
//
// 봇 음성 재생(useBotAudioPlayback)과 마이크 캡처(LiveSession/pcmCapture)는 서로
// 다른 컴포넌트에 산다. 두 가지 협조가 필요하다:
//   1) barge-in: 봇 음성이 나가는 중 고객이 다시 말을 시작하면 즉시 끊는다. 캡처
//      쪽에서 재생 쪽 audio 엘리먼트에 직접 닿을 수 없어, 재생 훅이 stop 함수를
//      여기 등록하고 캡처가 stopBotAudio()로 호출한다.
//   2) 에코 게이팅: 모바일은 스피커-마이크가 가까워 봇 음성이 마이크로 되먹임된다.
//      AEC가 다 못 거른 잔여가 VAD를 '고객 발화'로 오인하지 않도록, 봇이 말하는
//      동안(+짧은 꼬리 구간) isBotSpeaking()을 true로 노출해 캡처가 VAD 임계값을
//      올리게 한다.
//
// 한 화면에 라이브 세션은 하나뿐이므로 모듈 단일 등록(singleton)으로 충분하다.

let stopper: (() => void) | null = null;
let botSpeaking = false;

/** 봇 오디오 재생 훅이 자신의 중단 함수를 등록(언마운트 시 null로 해제). */
export function setBotAudioStopper(fn: (() => void) | null): void {
  stopper = fn;
}

/** 현재 재생 중인 봇 음성을 중단(미등록·미재생이면 no-op). 캡처의 발화 시작에서 호출. */
export function stopBotAudio(): void {
  stopper?.();
}

/** 봇 음성 재생 상태를 갱신. 재생 훅이 play 시작 시 true, 종료/꼬리 가드 후 false. */
export function setBotSpeaking(speaking: boolean): void {
  botSpeaking = speaking;
}

/** 봇이 (에코 꼬리 구간 포함) 말하는 중인지 — 캡처의 VAD 게이팅이 매 프레임 읽는다. */
export function isBotSpeaking(): boolean {
  return botSpeaking;
}
