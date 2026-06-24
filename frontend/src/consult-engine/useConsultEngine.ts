// useConsultEngine — AI 상담 화면 시나리오 엔진 (SSOT docs/consult_redesigned-3.html <script>).
//
// advance() → produceAI() → runChain() 흐름을 그대로 이식한다.
//   · 카드 애니메이션(card1/2/3): store에 단계별 dispatch → 컴포넌트 선언적 렌더
//   · STT 말풍선·word reveal·typing·flyKeywords·차량: imperative(ref/DOM) — 타이밍 핵심
//
// 전역 가변 상태는 useRef(리렌더 유발 X). 버튼 라벨 등 표시값만 useState.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { S, STEP_OF } from '@/consult-engine/data/scenario';
import { SCENARIO_CUSTOMER_NAME } from '@/lib/customerProfiles';
import type { ScenarioEntry, Kw } from '@/consult-engine/types';
import { DIM } from '@/consult-engine/data/strategy';
import {
  uaFor, dbFor, procFor, cmpFor, pickStrategies, clip, diagDur, complianceStateFor,
} from '@/consult-engine/utils';
import { useConsultStore } from '@/stores/consultStore';
import { useCard1Store } from '@/stores/card1Store';
import { useCard2Store } from '@/stores/card2Store';
import type { JourneyMapHandle } from '@/components/consult/JourneyMap';

export type ConsultEngineHandles = {
  /** STT steps-wrap 컨테이너 (sch{N} 자식 포함). */
  chatRef: RefObject<HTMLDivElement | null>;
  /** 여정맵 명령형 핸들. */
  mapRef: RefObject<JourneyMapHandle | null>;
  /** 카드① element (flyKeywords 목적지). */
  cardEmoRef: RefObject<HTMLElement | null>;
  callId: string;
  /**
   * 인사말에 넣을 고객 이름. 시나리오 원본의 '박서준' 토큰을 이 값으로 치환한다
   * (원본 데이터는 불변; 렌더 시점 치환). 미지정 시 원본 이름 유지.
   */
  customerName?: string;
};

type EngineState = {
  /** 다음 발화 버튼 라벨 + disabled. */
  btnLabel: string;
  btnDisabled: boolean;
  ended: boolean;
  /** 통화 타이머 (mm:ss). */
  timer: string;
};

const fmtTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export function useConsultEngine({ chatRef, mapRef, cardEmoRef, callId, customerName }: ConsultEngineHandles) {
  // 표시값(리렌더 필요).
  const [state, setState] = useState<EngineState>({
    btnLabel: '상담 시작', btnDisabled: false, ended: false, timer: '00:00',
  });

  // 전역 가변 상태(리렌더 X) — SSOT let 변수.
  const iRef = useRef(0);
  const custSeqRef = useRef(-1);
  const busyRef = useRef(false);
  const endedRef = useRef(false);
  const blockedRef = useRef(0);
  const secsRef = useRef(0);
  const secHRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCustRef = useRef<ScenarioEntry | null>(null);
  const lastCustUsedRef = useRef(false);
  const lastCustBubbleRef = useRef<HTMLElement | null>(null);
  const pipeTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // 현재 재생 중인 TTS 오디오 — 턴 전환/리셋 시 중복 재생 방지를 위해 추적.
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 스토어 액션.
  const consult = useConsultStore;
  const card1 = useCard1Store;
  const card2 = useCard2Store;

  // ── 타이머 헬퍼 (추적되는 setTimeout) ──
  const pT = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    pipeTimers.current.push(id);
    return id;
  }, []);
  const clearPipeTimers = useCallback(() => {
    pipeTimers.current.forEach(clearTimeout);
    pipeTimers.current = [];
  }, []);

  // ── TTS 재생 (SSOT 음성 — public/tts/seg{seq}.mp3) ──
  // S 배열 인덱스(iRef.current) = seq에 1:1 대응하므로 seg{seq}.mp3를 재생한다.
  // 텍스트 타이핑(revealWords) 시작과 동시에 호출해 음성·자막을 함께 내보낸다.
  // 직전 오디오는 중단(턴 전환 시 겹침 방지). 자동재생 차단 등 실패는 조용히 무시(자막은 정상).
  const playSeg = useCallback((seq: number) => {
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      const a = new Audio(`/tts/seg${seq}.mp3`);
      audioRef.current = a;
      void a.play().catch(() => {});
    } catch {
      /* 오디오 미지원/차단 — 자막만으로 진행 */
    }
  }, []);

  const stopSeg = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
  }, []);

  // ── 버튼 라벨 갱신 (SSOT setBtn) ──
  const setBtn = useCallback(() => {
    if (endedRef.current) {
      setState((s) => ({ ...s, btnDisabled: true, ended: true, btnLabel: '✓ 상담 종료' }));
      return;
    }
    if (busyRef.current) {
      setState((s) => ({ ...s, btnDisabled: true, btnLabel: '재생 중…' }));
      return;
    }
    setState((s) => ({ ...s, btnDisabled: false, btnLabel: iRef.current === 0 ? '상담 시작' : '다음 발화' }));
  }, []);

  // ── STT DOM 헬퍼 (SSOT chatHolder/buildWords/bubble/typing/revealWords) ──
  const chatHolder = useCallback((): HTMLElement => {
    const st = STEP_OF[Math.min(iRef.current, STEP_OF.length - 1)] || 0;
    const sc = chatRef.current?.querySelector<HTMLElement>(`#sch${st}`);
    return sc || (chatRef.current as HTMLElement);
  }, [chatRef]);

  const scrollChat = useCallback(() => {
    // .stt__body(스크롤 컨테이너)로 스크롤.
    const body = chatRef.current?.closest('#chat') as HTMLElement | null;
    if (body) body.scrollTop = body.scrollHeight;
  }, [chatRef]);

  // buildWords: txt를 .w span으로 토큰화 (키워드는 .kw + k-risk/k-go).
  const buildWords = useCallback((host: HTMLElement, txt: string, kwList?: Kw[]) => {
    const map: Record<string, { r?: 1; g?: 1 }> = {};
    (kwList || []).forEach((k) => {
      const key = typeof k === 'string' ? k : k.w;
      map[key] = typeof k === 'string' ? {} : k;
    });
    const tokens = txt.split(/(\s+)/);
    tokens.forEach((tok) => {
      if (/^\s+$/.test(tok)) {
        host.appendChild(document.createTextNode(tok));
        return;
      }
      const sp = document.createElement('span');
      sp.className = 'w';
      sp.textContent = tok;
      if (map[tok] !== undefined) {
        sp.classList.add('kw');
        if (map[tok].r) sp.classList.add('k-risk');
        if (map[tok].g) sp.classList.add('k-go');
      }
      host.appendChild(sp);
    });
  }, []);

  // bubble: 메시지 말풍선 생성 + 현재 단계 컨테이너에 추가. 반환 = .bubble element.
  const bubble = useCallback((s: ScenarioEntry): HTMLElement => {
    const m = document.createElement('div');
    m.className = 'msg ' + (s.who === 'cust' ? 'msg--cust' : 'msg--ai');
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = s.who === 'cust' ? '👤 고객' : '🤖 AI';
    const b = document.createElement('div');
    b.className = 'bubble';
    // 시나리오 원본의 고객 이름 토큰을 레코드 이름으로 치환(이름은 키워드가 아니라
    // 강조 토큰화에 영향 없음). customerName 미지정 시 원본 그대로.
    const txt =
      customerName && customerName !== SCENARIO_CUSTOMER_NAME
        ? s.txt.replaceAll(SCENARIO_CUSTOMER_NAME, customerName)
        : s.txt;
    buildWords(b, txt, s.kw);
    m.appendChild(nm);
    m.appendChild(b);
    chatHolder().appendChild(m);
    scrollChat();
    return b;
  }, [buildWords, chatHolder, scrollChat, customerName]);

  // typing: 임시 타이핑 버블 → ms 후 제거 + cb.
  const typing = useCallback((who: 'cust' | 'ai', cb: () => void) => {
    const m = document.createElement('div');
    m.className = 'msg typing ' + (who === 'cust' ? 'msg--cust' : 'msg--ai');
    m.innerHTML = '<span class="nm">' + (who === 'cust' ? '👤 고객' : '🤖 AI')
      + '</span><div class="bubble"><span class="dots"><i></i><i></i><i></i></span>'
      + (who === 'cust' ? '<span class="hint">음성 인식 중…</span>' : '<span class="hint">다음 수 계산 중…</span>')
      + '</div>';
    chatHolder().appendChild(m);
    scrollChat();
    pT(() => { m.remove(); cb(); }, who === 'cust' ? 560 : 480);
  }, [chatHolder, scrollChat, pT]);

  // aiLoading: 지속 로딩 버블 (제거는 호출자가).
  const aiLoading = useCallback((): HTMLElement => {
    const m = document.createElement('div');
    m.className = 'msg typing msg--ai';
    m.innerHTML = '<span class="nm">🤖 AI</span><div class="bubble"><span class="dots"><i></i><i></i><i></i></span><span class="hint">발화 준비 중…</span></div>';
    chatHolder().appendChild(m);
    scrollChat();
    return m;
  }, [chatHolder, scrollChat]);

  // revealWords: .w span 순차 노출 (52ms/키워드 120ms).
  const revealWords = useCallback((b: HTMLElement, cb: () => void) => {
    const ws = [...b.querySelectorAll<HTMLElement>('.w')];
    let k = 0;
    const tick = () => {
      if (k >= ws.length) { cb(); return; }
      const w = ws[k];
      w.classList.add('on');
      if (w.classList.contains('kw')) w.classList.add('pop');
      k++;
      scrollChat();
      pT(tick, w.classList.contains('kw') ? 120 : 52);
    };
    tick();
  }, [scrollChat, pT]);

  // ── 카드① orb 드롭 (store) ──
  const dropOrb = useCallback((cat: 'psy' | 'intent' | 'obstacle', dim: string, frag: string, tone?: 'easing' | 'pos') => {
    const label = (DIM[cat] && DIM[cat][dim]) || dim;
    card1.getState().setOrb(cat, { dim: label, frag, tone });
  }, [card1]);

  // ── flyKeywords (SSOT) — 고객 말풍선 → 카드① 클론 비행 + orb 순차 채움 ──
  const flyKeywords = useCallback((bubbleEl: HTMLElement | null, cb: () => void) => {
    const ua = uaFor(custSeqRef.current);
    const slotKeys: Array<'psy' | 'intent' | 'obstacle'> = ['psy', 'intent', 'obstacle'];
    const orbData = { psy: ua.psy, intent: ua.intent, obstacle: ua.obstacle };
    const fillSequential = () => {
      slotKeys.forEach((k, idx) => {
        pT(() => { const d = orbData[k]; if (d) dropOrb(k, d.dim, d.frag, d.tone); }, idx * 320);
      });
    };
    const bub = bubbleEl;
    const cardEmo = cardEmoRef.current;
    if (!bub || !cardEmo) { cb(); fillSequential(); return; }

    const HANDOFF_MS = 900, FLY_MS = 1100;
    bub.querySelectorAll('.kw').forEach((kw) => kw.classList.add('kw-hl', 'blink'));
    bub.classList.add('handoff');
    pT(() => {
      const r = bub.getBoundingClientRect();
      const t = cardEmo.getBoundingClientRect();
      const clone = document.createElement('div');
      clone.className = 'fly-bubble';
      clone.textContent = bub.textContent;
      clone.style.left = r.left + 'px';
      clone.style.top = r.top + 'px';
      clone.style.width = r.width + 'px';
      document.body.appendChild(clone);
      const dx = (t.left + t.width / 2) - (r.left + r.width / 2);
      const dy = (t.top + t.height * 0.42) - (r.top + r.height / 2);
      requestAnimationFrame(() => {
        clone.style.transform = `translate(${dx}px,${dy}px) scale(.7)`;
        clone.style.opacity = '0';
      });
      pT(() => { clone.remove(); bub.classList.remove('handoff'); cb(); fillSequential(); }, FLY_MS);
    }, HANDOFF_MS);
  }, [cardEmoRef, pT, dropOrb]);

  // ── resetChain: 카드 3개 초기화 (store) ──
  const resetChain = useCallback(() => {
    clearPipeTimers();
    consult.getState().setCardPhase('card1', 'idle');
    consult.getState().setCardPhase('card2', 'idle');
    consult.getState().setCardPhase('card3', 'idle');
    consult.getState().setCompliance(null);
    consult.getState().setCompBtn('idle');
    card1.getState().reset();
    card2.getState().reset();
  }, [clearPipeTimers, consult, card1, card2]);

  // ── runChain (SSOT) — 카드① → ② → ③ 순차 파이프라인 ──
  const runChain = useCallback((inS: ScenarioEntry, _outS: ScenarioEntry, onReveal: () => void) => {
    resetChain();
    consult.getState().setPipeSrc(`고객 “${clip(inS.txt, 30)}”`);
    const cs = custSeqRef.current;
    const ua = uaFor(cs), dbd = dbFor(cs), cmp = cmpFor(cs), proc = procFor(cs);

    // 카드①: 구슬은 flyKeywords가 채움. 여기선 run → 전략 swipe → resolve → ok.
    const t0 = 160;
    pT(() => consult.getState().setCardPhase('card1', 'run'), t0);
    const tArrow = t0 + 260;
    pT(() => { card1.getState().setSolveArrow(true); card1.getState().setStratPhase('swiping'); }, tArrow);
    const tSel = tArrow + 1100;
    pT(() => {
      const picks = pickStrategies(ua);
      card1.getState().setStratPhase('resolved');
      card1.getState().setPicked(picks);
    }, tSel);
    const t1 = tSel + 820;
    pT(() => consult.getState().setCardPhase('card1', 'ok'), t1);

    // 카드②: run → use cards → flash/bridge → diagram → ok.
    const t1b = t1 + 150;
    pT(() => { consult.getState().setCardPhase('card2', 'run'); card2.getState().setUse(dbd.use); }, t1b);
    const tFlash = t1b + 200 + dbd.use.length * 150 + 260;
    pT(() => { card2.getState().setFlash(true); card2.getState().setBridge(true); }, tFlash);
    const tRes = tFlash + 560;
    pT(() => {
      card2.getState().setDiag(proc);
      proc.nodes.forEach((_, idx) => pT(() => card2.getState().setShownNodes(idx + 1), idx * 260));
      pT(() => card2.getState().setBannerOn(true), proc.nodes.length * 260 + 120);
    }, tRes);
    const t2 = tRes + diagDur(proc) + 360;
    pT(() => consult.getState().setCardPhase('card2', 'ok'), t2);

    // 카드③: run + armed → draft → checks(순차) → final → ok + onReveal.
    const t2b = t2 + 150;
    pT(() => { consult.getState().setCardPhase('card3', 'run'); consult.getState().setCompBtn('armed'); }, t2b);
    pT(() => consult.getState().setCompliance(complianceStateFor(callId, cmp, 'draft')), t2b + 220);
    const tChk = t2b + 950;
    // 4규제 순차 체크 (160ms 간격) → 최종.
    cmp.flags.forEach((_, idx) => {
      pT(() => consult.getState().setCompliance(complianceStateFor(callId, cmp, idx)), tChk + idx * 160);
    });
    const tFinal = tChk + cmp.flags.length * 160;
    pT(() => consult.getState().setCompliance(complianceStateFor(callId, cmp, 'final')), tFinal);
    const finMs = cmp.final.length * 120 + 520;
    pT(() => { consult.getState().setCardPhase('card3', 'ok'); onReveal(); }, tFinal + finMs + 360);
  }, [resetChain, consult, card1, card2, pT, callId]);

  // ── stageEffects (SSOT) — 차량/배너/위험노드/체크포인트 ──
  const stageEffects = useCallback((s: ScenarioEntry) => {
    const map = mapRef.current;
    if (!map) return;
    const onArrive = () => {
      if (!s.risk) return;
      map.showRisk(s.risk.rz);
      map.shakeCar();
    };
    if (s.prog != null) map.moveCar(s.prog, 780, onArrive);
    else onArrive();
    if (s.cp) map.reach(s.cp);
    if (s.bann) map.setBanner(s.bann, s.prog ?? 0);
    if (s.def) {
      const rz = s.def.rz;
      pT(() => { map.setBlocked(rz); blockedRef.current++; }, 520);
    }
  }, [mapRef, pT]);

  // ── produceAI (SSOT) — AI 발화 노출 (카드 준비 후) ──
  const produceAI = useCallback(() => {
    if (iRef.current >= S.length || S[iRef.current].who !== 'ai') {
      busyRef.current = false;
      setBtn();
      return;
    }
    const aiS = S[iRef.current];
    const speak = (b: HTMLElement) => {
      try { stageEffects(aiS); } catch (err) { console.error('stage error', err); }
      playSeg(iRef.current);  // 자막 타이핑과 동시에 TTS 재생
      revealWords(b, () => {
        if (aiS.last) { endedRef.current = true; }
        iRef.current++;
        produceAI();
      });
    };
    const gatedSpeak = () => speak(bubble(aiS));
    const inS = lastCustRef.current && !lastCustUsedRef.current ? lastCustRef.current : null;
    if (inS) {
      lastCustUsedRef.current = true;
      let loader: HTMLElement | null = null;
      let done = false;
      const reveal = () => { if (done) return; done = true; if (loader) loader.remove(); gatedSpeak(); };
      const startCard = () => {
        loader = aiLoading();
        try { runChain(inS, aiS, reveal); } catch (err) { console.error('chain error', err); reveal(); }
      };
      if (lastCustBubbleRef.current) flyKeywords(lastCustBubbleRef.current, startCard);
      else startCard();
    } else {
      typing('ai', () => gatedSpeak());
    }
  }, [setBtn, stageEffects, revealWords, bubble, aiLoading, runChain, flyKeywords, typing, playSeg]);

  // ── advance (SSOT) — 버튼 클릭 1회 ──
  const advance = useCallback(() => {
    if (busyRef.current || endedRef.current) return;
    if (iRef.current >= S.length) return;
    busyRef.current = true;
    setBtn();
    const s = S[iRef.current];
    if (s.who === 'cust' && s.greet) {
      // 인사("여보세요?") — 분석 파이프라인을 트리거하지 않는다. 말풍선만 노출하고
      // custSeq/lastCust를 건드리지 않아, 뒤따르는 AI 인사가 분석 없이 발화된다.
      typing('cust', () => {
        const b = bubble(s);
        try { stageEffects(s); } catch (err) { console.error('stage error', err); }
        playSeg(iRef.current);  // 자막 타이핑과 동시에 TTS 재생
        revealWords(b, () => {
          iRef.current++;
          produceAI();
        });
      });
    } else if (s.who === 'cust') {
      typing('cust', () => {
        const b = bubble(s);
        try { stageEffects(s); } catch (err) { console.error('stage error', err); }
        playSeg(iRef.current);  // 자막 타이핑과 동시에 TTS 재생
        revealWords(b, () => {
          lastCustRef.current = s;
          lastCustUsedRef.current = false;
          lastCustBubbleRef.current = b;
          custSeqRef.current++;
          iRef.current++;
          produceAI();
        });
      });
    } else {
      produceAI();
    }
  }, [setBtn, typing, bubble, stageEffects, revealWords, produceAI, playSeg]);

  // ── 타이머 시작 ──
  const startTimer = useCallback(() => {
    if (secHRef.current) return;
    secHRef.current = setInterval(() => {
      secsRef.current++;
      setState((s) => ({ ...s, timer: fmtTime(secsRef.current) }));
    }, 1000);
  }, []);

  // ── reset (SSOT) — 전체 초기화 ──
  const reset = useCallback(() => {
    clearPipeTimers();
    stopSeg();  // 재생 중인 TTS 중단
    if (secHRef.current) { clearInterval(secHRef.current); secHRef.current = null; }
    iRef.current = 0;
    custSeqRef.current = -1;
    busyRef.current = false;
    endedRef.current = false;
    blockedRef.current = 0;
    secsRef.current = 0;
    lastCustRef.current = null;
    lastCustUsedRef.current = false;
    lastCustBubbleRef.current = null;
    // STT 비우기.
    chatRef.current?.querySelectorAll('.mini-chats').forEach((el) => { el.innerHTML = ''; });
    // 비행 클론 잔재 제거.
    document.querySelectorAll('.fly-bubble').forEach((el) => el.remove());
    resetChain();
    consult.getState().setPipeSrc('상담 시작 대기');
    mapRef.current?.resetMap();
    setState({ btnLabel: '상담 시작', btnDisabled: false, ended: false, timer: '00:00' });
  }, [clearPipeTimers, stopSeg, chatRef, resetChain, consult, mapRef]);

  // 클릭 핸들러 — 첫 클릭 시 타이머 시작.
  const onAdvance = useCallback(() => {
    startTimer();
    advance();
  }, [startTimer, advance]);

  // 언마운트 정리.
  useEffect(() => () => {
    pipeTimers.current.forEach(clearTimeout);
    if (secHRef.current) clearInterval(secHRef.current);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
  }, []);

  return { ...state, advance: onAdvance, reset };
}
