// useBotAudioPlayback — 라이브 모드에서 봇 발화 TTS mp3를 순차 재생.
//
// 백엔드(persist → Typecast → S3)가 봇 Turn에 audioUrl(presigned mp3)을 실어
// onTurn으로 팬아웃한다. 이 훅은 onTurn을 구독해 bot Turn의 audioUrl이 도착하면
// 큐에 넣고 하나씩 재생한다(겹치지 않게). customer/agent Turn·audioUrl 없는 Turn은 무시.
//
// 자동재생 정책: 브라우저는 사용자 제스처 없는 .play()를 막을 수 있다 — 통화 화면은
// '다음 발화'/통화 버튼 등 제스처 뒤에 진입하므로 대체로 허용되지만, 거부(reject)는
// 조용히 삼킨다(텍스트 흐름을 막지 않음). seq 중복 재생은 막는다(re-emit 멱등).
'use client';

import { useEffect, useRef } from 'react';
import * as appsyncMod from '@/lib/appsync';
import { setBotAudioStopper } from '@/lib/botAudioControl';
import type { Turn } from '@/types/realtime';

type Options = {
  /** true면 구독/재생을 건너뛴다(스크립트·목 데모 화면). */
  disabled?: boolean;
  /** 0.0–1.0 볼륨 (기본 1.0). */
  volume?: number;
};

export function useBotAudioPlayback(callId: string, options: Options = {}): void {
  const { disabled = false, volume = 1 } = options;

  // 렌더 간 유지되는 재생 큐/상태 (재구독 없이).
  const queueRef = useRef<string[]>([]);
  const playedSeqRef = useRef<Set<number>>(new Set());
  const playingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (disabled || !callId) return;
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return;

    const audio = new Audio();
    audio.volume = Math.max(0, Math.min(1, volume));
    audioRef.current = audio;

    const playNext = () => {
      if (playingRef.current) return;
      const url = queueRef.current.shift();
      if (!url) return;
      playingRef.current = true;
      audio.src = url;
      const done = () => {
        playingRef.current = false;
        playNext();
      };
      audio.onended = done;
      audio.onerror = done; // 한 클립 실패가 큐 전체를 막지 않게
      // play()는 Promise — 자동재생 거부 등은 조용히 삼키고 다음으로.
      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => done());
      }
    };

    const onTurn = (turn: Turn) => {
      if (turn.speaker !== 'bot' || !turn.audioUrl) return;
      if (playedSeqRef.current.has(turn.seq)) return; // re-emit 멱등
      playedSeqRef.current.add(turn.seq);
      queueRef.current.push(turn.audioUrl);
      playNext();
    };

    // barge-in: 봇 음성 재생 중 고객이 다시 말하기 시작하면(LiveSession이 VAD로 감지)
    // 즉시 현재 클립을 멈추고 대기 큐를 비운다. onended/onerror를 떼고 일시정지해
    // playNext가 다음 클립으로 넘어가지 않게 한다(playing 플래그도 내림).
    const stopAll = () => {
      queueRef.current = [];
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      playingRef.current = false;
    };
    setBotAudioStopper(stopAll);

    // Guard: 부분 mock 테스트가 subscribeTurns를 생략할 수 있다(JourneyMap §live 패턴).
    // 존재·타입 확인 후 접근 — Vitest mock 프록시가 undefined named export에 throw하는 것 방지.
    if (!('subscribeTurns' in appsyncMod)) return;
    const subscribeTurns = appsyncMod.subscribeTurns;
    if (typeof subscribeTurns !== 'function') return;
    const unsubscribe = subscribeTurns(callId, onTurn, (err) =>
      console.error('onTurn(audio) 구독 오류', err),
    );

    return () => {
      setBotAudioStopper(null);
      unsubscribe();
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audioRef.current = null;
      queueRef.current = [];
      playingRef.current = false;
      playedSeqRef.current = new Set();
    };
  }, [callId, disabled, volume]);
}
