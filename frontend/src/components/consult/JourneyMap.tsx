// JourneyMap — 상담 여정 맵 MOT 마커 + 플로팅 (FRONTEND-009 / #38).
// SSOT: docs/consult_redesigned-3.html 여정 맵 (절대 기준).
//
// MOT 마커: #rz-rate|#rz-compare|#rz-pay|#rz-security|#rz-avoid (MOT_1~5)
//   상태 전이: hidden(opacity:0) → show → alert → blocked
//
// 플로팅: 차량이 위험 지점에 도착하면 #cautionPop(.show) 표시.
//   방어(outcome=defended)시 cautionPop 제거 + 마커 blocked.
//
// 내러티브: #banner(.nav-banner) eyebrow/lead/dist를 risk/def/done 상태로 갱신.
//   FRONTEND-012: churnRisk% → bannerDist + .rz marker risk-zone emphasis.
//
// Mock-first: BACKEND-007(mots/onMotDetected) 미완료.
//   disableLiveData=true 또는 NEXT_PUBLIC_USE_MOCK=1 이면 mock만 사용.
'use client';

import {
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { clsx } from 'clsx';
import { subscribeMotDetected, fetchMots } from '@/lib/appsync';
import * as appsyncMod from '@/lib/appsync';
import {
  useMotStore,
  MOT_MARKER_IDS,
  type MotMarkerId,
  type MarkerState,
} from '@/stores/motStore';
import type { MotDetected } from '@/types/realtime';
import { CAR_IMAGE_HREF } from '@/consult-engine/data/carImage';
import type { BannerContent as EngineBanner } from '@/consult-engine/types';

// ── 엔진(useConsultEngine)이 호출하는 명령형 핸들 ──────────────────────────────
// SSOT의 moveCar/setCar/revealRoute/reach/setBanner/stageEffects는 getPointAtLength·
// stroke-dashoffset·rAF 기반이라 선언적 state로 옮기기 부적합 → ref로 노출해 그대로 구동.
export type JourneyMapHandle = {
  /** 차량을 prog(0–1)까지 ms 동안 주행 (rAF easeInOutQuad). 도착 시 cb. */
  moveCar: (to: number, ms: number, cb?: () => void) => void;
  /** 체크포인트 도달: 이전은 done, 현재는 now (SSOT reach). */
  reach: (cpId: string) => void;
  /** 위험노드 표시(alert) + cautionPop. */
  showRisk: (rzId: string) => void;
  /** 위험노드 방어 완료(blocked) + cautionPop 숨김. */
  setBlocked: (rzId: string) => void;
  /** 네비 배너 갱신 (SSOT setBanner). */
  setBanner: (b: EngineBanner | null, prog: number) => void;
  /** 차량 흔들기 (위험 도착 시). */
  shakeCar: () => void;
  /** 전체 초기화: 차량 0, 경로 미표시, 마커 hidden. */
  resetMap: () => void;
};

// rz 접미사(rate/compare/…) → MOT 마커 element id.
const rzToMarkerId = (rz: string): MotMarkerId | null => {
  const id = `rz-${rz}` as MotMarkerId;
  return MOT_MARKER_IDS.includes(id) ? id : null;
};

// SSOT 좌표: docs/consult_redesigned-3.html 각 rz 요소의 transform="translate(x,y)"
const MOT_MARKER_COORDS: Record<MotMarkerId, { x: number; y: number; label: string }> = {
  'rz-rate':     { x: 215,  y: 322, label: 'MOT_1' },
  'rz-compare':  { x: 430,  y: 330, label: 'MOT_2' },
  'rz-pay':      { x: 930,  y: 332, label: 'MOT_3' },
  // 10턴 축약 데모는 rate/compare/security 3개 MOT만 도달하고 pay(MOT_3)는 표시되지
  // 않는다(showRisk 미호출 → opacity 0). 따라서 화면상 세 번째로 보이는 security 마커가
  // MOT_2 다음에 MOT_4로 건너뛰어 보였다. 시각적 연속성을 위해 MOT_3으로 표시한다.
  'rz-security': { x: 1205, y: 336, label: 'MOT_3' },
  'rz-avoid':    { x: 1300, y: 322, label: 'MOT_5' },
};

// MOT markers are flat hz-style ellipses (rx46 ry16, SSOT #hz) shifted below the
// route so they (a) stay inside the frame rect (y 30–408: max 336+56+16=408) and
// (b) clear the car circle (r=38) on the route: marker top(cy-16) ≥ car bottom.
// cautionCoords receives the SAME offset so the "!" pop-up stays above the marker.
const MOT_Y_OFFSET = 56;
const MOT_RY = 16;

// SSOT animationDelay 순서 대로 (rz-rate 0s, rz-compare 0.6s, rz-pay 1.1s, rz-security 1.6s, rz-avoid 2.1s)
const ANIMATION_DELAY: Record<MotMarkerId, string> = {
  'rz-rate':     '0s',
  'rz-compare':  '0.6s',
  'rz-pay':      '1.1s',
  'rz-security': '1.6s',
  'rz-avoid':    '2.1s',
};

// seq(1-based) → MotMarkerId mapping — MOT_1 is seq=1
function seqToMarkerId(seq: number): MotMarkerId | null {
  const id = MOT_MARKER_IDS[seq - 1];
  return id ?? null;
}

// ── RzMarker — SSOT .rz SVG 그룹 ─────────────────────────────────────────────
// MOT 마커는 SSOT #hz 언더글로와 같은 평평한 타원(rx46 ry19)으로 통일한다.
// 낮고 넓은 형태라 프레임 안에 들어가고 경로 위 차량 원과도 거의 겹치지 않는다.
// rz-core class kept as harmless string for SSOT lineage; no external CSS needed.
function RzCore({ id, state: markerState }: { id: MotMarkerId; state: MarkerState }) {
  const delay = ANIMATION_DELAY[id];

  // Stroke color: alert/show→hazard, blocked→go
  const strokeColor =
    markerState === 'blocked' ? 'var(--go)' : 'var(--hazard)';
  // Fill: blocked gets a subtle go tint
  const fillColor =
    markerState === 'blocked' ? 'var(--cmp-final, #f5fbf8)' : '#fff';

  return (
    <ellipse
      className="rz-core"
      rx={46}
      ry={MOT_RY}
      fill={fillColor}
      stroke={strokeColor}
      strokeWidth={2.4}
      strokeDasharray={markerState === 'blocked' ? 'none' : '4 5'}
      style={{ animationDelay: delay }}
    />
  );
}

type RzMarkerProps = {
  id: MotMarkerId;
  markerState: MarkerState;
  /** FRONTEND-012: churnRisk >= 50 → risk-zone marker emphasis */
  riskActive?: boolean;
};

// Note: 'rz', 'show', 'alert', 'blocked' class names are kept because
// mot.test.tsx asserts them via toHaveClass(). They are the test contract.
function RzMarker({ id, markerState, riskActive = false }: RzMarkerProps) {
  const { x, y, label } = MOT_MARKER_COORDS[id];
  const cls = clsx(
    'rz',
    markerState === 'show' && 'show',
    markerState === 'alert' && 'show alert',
    markerState === 'blocked' && 'show blocked',
    // FRONTEND-012: churnRisk >= 50 → add risk-active emphasis on hidden/shown markers
    riskActive && markerState !== 'blocked' && 'risk-active',
  );

  // Opacity: hidden→0, show/alert/blocked→1
  const opacity = markerState === 'hidden' ? 0 : 1;

  return (
    <g
      className={cls}
      id={id}
      transform={`translate(${x},${y + MOT_Y_OFFSET})`}
      data-testid={`mot-marker-${id}`}
      data-marker-state={markerState}
      data-risk-active={riskActive ? 'true' : undefined}
      style={{
        opacity,
        transition: 'opacity 0.4s ease',
        // risk-active: subtle hazard glow outline effect via filter
        filter:
          riskActive && markerState !== 'blocked'
            ? 'drop-shadow(0 0 6px var(--hazard))'
            : undefined,
      }}
    >
      {/* 변곡점(그래프 선) → 마커 연결선 — 마커는 +MOT_Y_OFFSET 아래라 변곡점은 위(음수 dy). */}
      <Leader dy={-MOT_Y_OFFSET} fromRadius={MOT_RY} color="var(--hazard)" />
      <RzCore id={id} state={markerState} />
      <text
        className="rz-label"
        y={5}
        textAnchor="middle"
        fill={markerState === 'blocked' ? 'var(--go)' : 'var(--hazard)'}
        fontFamily="var(--kr)"
        fontSize={18}
        fontWeight={800}
      >
        {label}
      </text>
      {/* rz-done: 방어 완료 체크 배지 (SSOT) — visible only when blocked */}
      <g
        className="rz-done"
        transform="translate(24,-22)"
        style={{ opacity: markerState === 'blocked' ? 1 : 0 }}
      >
        <circle r={9} fill="var(--go)" />
        <path
          d="M-4.5,0 l3,3 5,-6"
          stroke="#fff"
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </g>
  );
}

// ── CautionPop — SSOT #cautionPop (! 경고 삼각형) ────────────────────────────
// 'show' class is kept because mot.test.tsx asserts it via toHaveClass('show').
type CautionPopProps = {
  visible: boolean;
  x: number;
  y: number;
};

function CautionPop({ visible, x, y }: CautionPopProps) {
  return (
    <g
      id="cautionPop"
      className={clsx(visible && 'show')}
      transform={`translate(${x},${y - 48})`}
      data-testid="caution-pop"
      data-visible={String(visible)}
      style={{
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.3s ease',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <path
        d="M0,-18 L17,13 H-17 Z"
        fill="var(--danger)"
        stroke="#fff"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <text
        x={0}
        y={9}
        textAnchor="middle"
        fontSize={18}
        fontWeight={700}
        fill="#fff"
        fontFamily="var(--disp)"
      >
        !
      </text>
    </g>
  );
}

// ── MapFrame — SSOT section frame rectangles + labels ────────────────────────
function MapFrame() {
  return (
    <g textAnchor="middle" className="mapframe">
      <rect x={30}   y={30} width={535} height={378} rx={20} fill="#fff" opacity={0.28} stroke="#C8D2DD" strokeDasharray="3 6"/>
      <rect x={585}  y={30} width={730} height={378} rx={20} fill="#fff" opacity={0.28} stroke="#C8D2DD" strokeDasharray="3 6"/>
      <rect x={1335} y={30} width={258} height={378} rx={20} fill="#fff" opacity={0.28} stroke="#C8D2DD" strokeDasharray="3 6"/>
      <g fontFamily="Inter,Pretendard,sans-serif" fontSize={20} fontWeight={800} fill="#111827">
        <text x={297}  y={51}>본인 확인</text>
        <text x={950}  y={51}>상품 제안</text>
        <text x={1464} y={51}>대출 접수</text>
      </g>
      <g fontFamily="Pretendard,sans-serif" fontSize={12} fontWeight={700} fill="#9CAAB9">
        <text x={1464} y={70}>AI접수 · 신청문자발송</text>
      </g>
    </g>
  );
}

// ── AxisLines — SSOT horizontal axis + vertical threshold + labels ────────────
function AxisLines() {
  return (
    <>
      {/* 가로축: 상담 진행(시간) */}
      <g className="mapframe" fontFamily="JetBrains Mono,monospace" fontSize={10} fontWeight={700} letterSpacing={2} fill="#9CAAB9">
        <line x1={55} y1={412} x2={1560} y2={412} stroke="#C8D2DD" strokeWidth={1.5} strokeDasharray="2 5"/>
        <path d="M1560,412 l-9,-4 v8 z" fill="#C8D2DD"/>
        <text x={55} y={404} textAnchor="start">상담 경과 시간</text>
      </g>

      {/* 세로축: 고객 상태 */}
      <g className="mapframe">
        <line x1={55} y1={230} x2={1560} y2={230} stroke="#8E9BAB" strokeWidth={1.6} strokeDasharray="10 8" opacity={0.9}/>
        <g fontFamily="Pretendard,sans-serif" fontSize={18} fontWeight={800} textAnchor="start">
          <text x={63} y={106} fill="var(--go)">▲ 전환 가능</text>
          <text x={63} y={354} fill="var(--danger)">▼ 이탈 위험</text>
        </g>
      </g>
    </>
  );
}

// ── Route paths — SSOT ghost/route/routeInk/routeCore paths ──────────────────
// s1.json 10턴 축약 정합: 삭제된 turn(rz-pay@930 / rz-avoid@1300 + 조건이해·한도조회·
// 신청검토 구간)의 경유 좌표를 모두 제거하고, 실제 도달하는 9개 앵커만 통과하도록 재생성.
//   (70,232) 시작·관심 | (215,322) rz-rate | (320,250) 방어 | (430,330) rz-compare
//   (575,205) 신뢰확보 | (1205,336) rz-security | (1255,290) 방어 | (1410,178) | (1545,120) GOAL
const ROUTE_D = "M70.0,232.0 C94.2,247.0 173.3,319.0 215.0,322.0 C256.7,325.0 284.2,248.7 320.0,250.0 C355.8,251.3 387.5,337.5 430.0,330.0 C472.5,322.5 445.8,204.0 575.0,205.0 C704.2,206.0 1091.7,321.8 1205.0,336.0 C1318.3,350.2 1220.8,316.3 1255.0,290.0 C1289.2,263.7 1361.7,206.3 1410.0,178.0 C1458.3,149.7 1522.5,129.7 1545.0,120.0";

type RoutePathsProps = {
  routeRef: React.Ref<SVGPathElement>;
  routeInkRef: React.Ref<SVGUseElement>;
  routeCoreRef: React.Ref<SVGUseElement>;
};

function RoutePaths({ routeRef, routeInkRef, routeCoreRef }: RoutePathsProps) {
  return (
    <>
      {/* 예상(고스트) 경로 — opacity는 globals.css #ghost/#ghost.show 로 제어 */}
      <path
        id="ghost"
        className="ghost"
        fill="none"
        stroke="var(--route-2)"
        strokeWidth={7}
        strokeLinecap="round"
        d={ROUTE_D}
      />
      {/* 재탐색(확정) 경로 */}
      <path ref={routeRef} id="route" fill="none" d={ROUTE_D} />
      {/* 주행 완료 구간: routeInk */}
      <use ref={routeInkRef} href="#route" stroke="url(#routegrad)" strokeWidth={13} fill="none" strokeLinecap="round" filter="url(#glow)" id="routeInk" />
      {/* routeCore */}
      <use ref={routeCoreRef} href="#route" stroke="#EAF1FF" strokeWidth={4} fill="none" strokeLinecap="round" id="routeCore" />
    </>
  );
}

// ── Leader — 변곡점(그래프 선) → 원을 잇는 연결선 ─────────────────────────────
// 노드는 경로에서 떨어져 배치되므로, 원의 로컬 좌표(0,0)에서 그래프 변곡점까지
// 선을 긋고 변곡점에 작은 점을 찍는다. dy = 변곡점.y − 노드.y (노드 로컬 기준).
// pathLength=1 로 정규화해 CSS stroke-dashoffset 그리기 애니메이션을 길이 무관하게 적용.
function Leader({ dy, fromRadius, color }: { dy: number; fromRadius: number; color: string }) {
  // 원 가장자리에서 출발해 변곡점까지. dy 부호로 위/아래 모두 대응.
  const start = dy >= 0 ? fromRadius : -fromRadius;
  return (
    <g className="leader" aria-hidden="true">
      <line
        className="leader-line"
        x1={0}
        y1={start}
        x2={0}
        y2={dy}
        stroke={color}
        strokeWidth={2}
        strokeDasharray="3 4"
        strokeLinecap="round"
        pathLength={1}
      />
      <circle className="leader-dot" cx={0} cy={dy} r={4} fill={color} stroke="#fff" strokeWidth={1.5} />
    </g>
  );
}

// 그래프 변곡점 y (원래 경로상 위치). 노드는 여기서 떨어져 배치되고 Leader 가 이어준다.
const CP_INFLECTION_Y: Record<string, number> = {
  'cp-interest': 232,
  'cp-trust': 205,
};

// ── CpNode — SSOT .cp checkpoint circle node ─────────────────────────────────
type CpNodeProps = {
  id: string;
  x: number;
  y: number;
  label: string;
  isGoal?: boolean;
};

function CpNode({ id, x, y, label, isGoal = false }: CpNodeProps) {
  if (isGoal) {
    return (
      <g className="cp" id={id} transform={`translate(${x},${y})`}>
        {/* cp-ring: 도달(.now) 시 nowring 파장 (SSOT goal: r=46, go 색). */}
        <circle className="cp-ring" r={46} fill="none" stroke="var(--go)" strokeWidth={3}/>
        <circle className="cp-core" r={36} fill="#fff" stroke="var(--route)" strokeWidth={4} filter="url(#soft)"/>
        <path d="M-11,-16 v32 M-11,-16 h17 l-4,6 4,6 h-17" fill="var(--route)" stroke="var(--route)" strokeWidth={2} strokeLinejoin="round"/>
        <text
          y={66}
          fontFamily="JetBrains Mono,monospace"
          fontSize={12}
          fontWeight={700}
          fill="var(--route)"
          letterSpacing={2}
          textAnchor="middle"
        >
          전환 GOAL
        </text>
      </g>
    );
  }
  const inflectionY = CP_INFLECTION_Y[id];
  return (
    <g className="cp" id={id} transform={`translate(${x},${y})`}>
      {/* 변곡점(그래프 선) → 원 연결선 — 원보다 먼저 그려 원 아래에 깔리게. */}
      {inflectionY !== undefined && (
        <Leader dy={inflectionY - y} fromRadius={42} color="#9FB0C4" />
      )}
      {/* cp-ring: 도달(.now) 시 nowring 파장이 퍼지는 링 (SSOT). 평소 opacity:0. */}
      <circle className="cp-ring" r={50} fill="none" stroke="var(--route)" strokeWidth={3}/>
      <circle className="cp-core" r={42} fill="#fff" stroke="#9FB0C4" strokeWidth={3} filter="url(#soft)"/>
      <text className="cp-label" y={5} textAnchor="middle" fill="var(--ink-dim)"
        fontFamily="Pretendard,sans-serif" fontSize={19} fontWeight={800}
      >
        {label}
      </text>
      <g className="cp-check" transform="translate(30,-30)">
        <circle r={9} fill="var(--route)"/>
        <path d="M-4.5,0 l3,3 5,-6" stroke="#fff" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      </g>
    </g>
  );
}

// ── SVG Defs ─────────────────────────────────────────────────────────────────
function SvgDefs() {
  return (
    <defs>
      <pattern id="dots" width={26} height={26} patternUnits="userSpaceOnUse">
        <circle cx={2} cy={2} r={1.1} fill="#cbd0d8" opacity={0.55}/>
      </pattern>
      <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
        <feDropShadow dx={0} dy={3} stdDeviation={4} floodColor="#26374e" floodOpacity={0.2}/>
      </filter>
      <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation={6} result="b"/>
        <feMerge>
          <feMergeNode in="b"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <linearGradient id="routegrad" x1={0} y1={0} x2={1} y2={0}>
        <stop offset={0} stopColor="#2C5BD6"/>
        <stop offset={1} stopColor="#4D7CF0"/>
      </linearGradient>
      <clipPath id="carClip">
        <circle r={33} cx={0} cy={0}/>
      </clipPath>
    </defs>
  );
}

// ── JourneyMap ────────────────────────────────────────────────────────────────
export type JourneyMapProps = {
  callId: string;
  /** Tests / Storybook: seed initial MOTs and skip live subscription. */
  initialMots?: MotDetected[];
  /** Tests / Storybook: seed initial churnRisk (0-100) for bannerDist. */
  initialChurnRisk?: number | null;
  disableLiveData?: boolean;
};

export const JourneyMap = forwardRef<JourneyMapHandle, JourneyMapProps>(function JourneyMap({
  callId,
  initialMots,
  initialChurnRisk = null,
  disableLiveData = false,
}: JourneyMapProps, ref) {
  const { mots, markers, activeCautionSeq, addMot, setMarkerState, showCaution, hideCaution, reset } =
    useMotStore();

  // ── 엔진 구동용 (명령형) ──────────────────────────────────────────────────
  // 차량/경로는 getPointAtLength·stroke-dashoffset 기반 → state 아닌 ref + 직접 DOM.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const routeRef = useRef<SVGPathElement | null>(null);
  const routeInkRef = useRef<SVGUseElement | null>(null);
  const routeCoreRef = useRef<SVGUseElement | null>(null);
  const carPosRef = useRef<SVGGElement | null>(null);
  const carBodyRef = useRef<SVGGElement | null>(null);
  const routeLenRef = useRef(0); // getTotalLength() 캐시
  const curProgRef = useRef(0); // 매 rAF 프레임 변형 — state 금지
  const rafRef = useRef<number | null>(null);
  // 통화 시작(차량 주행 개시) 여부 — engineMode에서 #svg.playing 토글.
  const [enginePlaying, setEnginePlaying] = useState(false);

  // setCar: prog(0–1) 위치로 차량 이동 + 경로 채움 (SSOT setCar/revealRoute).
  const setCar = (prog: number) => {
    const route = routeRef.current;
    const L = routeLenRef.current;
    // jsdom 등 getPointAtLength 미구현 환경 가드.
    if (!route || !L || typeof route.getPointAtLength !== 'function') return;
    prog = Math.max(0, Math.min(1, prog));
    const p = route.getPointAtLength(L * prog);
    carPosRef.current?.setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
    const off = L * (1 - prog);
    if (routeInkRef.current) routeInkRef.current.style.strokeDashoffset = String(off);
    if (routeCoreRef.current) routeCoreRef.current.style.strokeDashoffset = String(off);
  };

  // ── 마운트: 경로 길이 측정 + dash 초기화 + 차량 0 위치 ──────────────────────
  useEffect(() => {
    const route = routeRef.current;
    if (!route || typeof route.getTotalLength !== 'function') return;
    const L = route.getTotalLength();
    routeLenRef.current = L;
    [routeInkRef.current, routeCoreRef.current].forEach((u) => {
      if (!u) return;
      u.style.strokeDasharray = `${L} ${L}`;
      u.style.strokeDashoffset = String(L);
    });
    setCar(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 명령형 핸들 노출 (엔진이 호출) ──────────────────────────────────────────
  useImperativeHandle(ref, (): JourneyMapHandle => ({
    moveCar(to, ms, cb) {
      to = Math.max(0, Math.min(1, to));
      setEnginePlaying(true);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const from = curProgRef.current;
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / ms);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // easeInOutQuad
        curProgRef.current = from + (to - from) * e;
        setCar(curProgRef.current);
        if (k < 1) {
          rafRef.current = requestAnimationFrame(step);
        } else {
          rafRef.current = null;
          cb?.();
        }
      };
      rafRef.current = requestAnimationFrame(step);
    },
    reach(cpId) {
      // s1.json 10턴 축약 정합: 실제 도달하는 체크포인트만(interest/trust/goal).
      const ORDER = ['interest', 'trust', 'goal'];
      const idx = ORDER.indexOf(cpId);
      ORDER.forEach((n, j) => {
        const el = svgRef.current?.querySelector(`#cp-${n}`);
        if (!el) return;
        el.classList.remove('now', 'done');
        if (j < idx) el.classList.add('done');
        else if (j === idx) el.classList.add('now');
      });
    },
    showRisk(rz) {
      const id = rzToMarkerId(rz);
      if (id) {
        setMarkerState(id, 'alert', MOT_MARKER_IDS.indexOf(id) + 1);
        showCaution(MOT_MARKER_IDS.indexOf(id) + 1);
      }
    },
    setBlocked(rz) {
      const id = rzToMarkerId(rz);
      if (id) {
        setMarkerState(id, 'blocked', MOT_MARKER_IDS.indexOf(id) + 1);
        hideCaution();
      }
    },
    // NavBanner 제거됨 — 엔진 호출 계약 유지를 위한 no-op.
    setBanner() {},
    shakeCar() {
      const el = carBodyRef.current;
      if (!el) return;
      el.style.animation = 'none';
      if (typeof el.getBBox === 'function') void el.getBBox(); // reflow
      el.style.animation = 'shake .5s ease-in-out 2';
    },
    resetMap() {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      curProgRef.current = 0;
      setCar(0);
      setEnginePlaying(false);
      reset();
      svgRef.current?.querySelectorAll('.cp').forEach((el) => el.classList.remove('now', 'done'));
    },
  }));

  // 언마운트 시 rAF 정리
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  // FRONTEND-012: churnRisk% → bannerDist + rz marker risk-zone emphasis
  const [churnRisk, setChurnRisk] = useState<number | null>(initialChurnRisk ?? null);

  // ── seed initialMots (always, even in live mode — hydrate from query result)
  useEffect(() => {
    reset();
    if (initialMots && initialMots.length > 0) {
      for (const mot of initialMots) {
        hydrateMot(mot);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  // ── initial query load (fetchMots) ──────────────────────────────────────────
  useEffect(() => {
    if (disableLiveData || initialMots !== undefined) return;
    let cancelled = false;
    fetchMots(callId).then((mots) => {
      if (cancelled) return;
      for (const mot of mots) hydrateMot(mot);
    }).catch((err) => {
      console.error('mots 쿼리 오류', err);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, disableLiveData]);

  // ── live subscription: onMotDetected ────────────────────────────────────────
  useEffect(() => {
    if (disableLiveData) return;
    const unsubscribe = subscribeMotDetected(
      callId,
      (mot) => hydrateMot(mot),
      (err) => console.error('onMotDetected 구독 오류', err),
    );
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, disableLiveData]);

  // ── FRONTEND-012: live subscription: onIndexUpdate → churnRisk ──────────────
  useEffect(() => {
    if (disableLiveData) return;
    // Guard: partial test mocks may omit subscribeIndexUpdate — check existence
    // before access to avoid Vitest mock proxy throw on undefined named exports.
    if (!('subscribeIndexUpdate' in appsyncMod)) return;
    const sub = appsyncMod.subscribeIndexUpdate;
    if (typeof sub !== 'function') return;
    const unsubscribe = sub(
      callId,
      (index) => { if (index.churnRisk != null) setChurnRisk(index.churnRisk); },
      (err) => console.error('onIndexUpdate(JourneyMap) 구독 오류', err),
    );
    return unsubscribe;
  }, [callId, disableLiveData]);

  // ── helper: apply a single MotDetected to store state ──────────────────────
  function hydrateMot(mot: MotDetected) {
    addMot(mot);
    const markerId = seqToMarkerId(mot.seq);
    if (!markerId) return;

    if (mot.outcome === 'defended') {
      // Defense: hide cautionPop, mark blocked
      hideCaution();
      setMarkerState(markerId, 'blocked', mot.seq);
    } else {
      // Risk arrival: show + alert state, show cautionPop
      setMarkerState(markerId, 'alert', mot.seq);
      showCaution(mot.seq);
    }
  }

  // Determine which marker is showing cautionPop.
  // Apply MOT_Y_OFFSET so the "!" triangle stays anchored above the (now-lowered) marker.
  const cautionMarkerId =
    activeCautionSeq !== null ? seqToMarkerId(activeCautionSeq) : null;
  const cautionCoords = cautionMarkerId
    ? { x: MOT_MARKER_COORDS[cautionMarkerId].x, y: MOT_MARKER_COORDS[cautionMarkerId].y + MOT_Y_OFFSET }
    : { x: 0, y: 0 };

  // A marker is "risk-active" if churnRisk >= 50 (high-risk zone emphasis per SSOT)
  const isHighRisk = churnRisk !== null && churnRisk >= 50;

  // SSOT: #svg.playing — 통화 시작(MOT 수신 또는 엔진 주행) 시 mapframe/carPos 표시
  const isPlaying = enginePlaying || mots.length > 0;

  return (
    <section
      className="relative w-full h-full"
      aria-label="상담 여정 맵"
      data-testid="journey-map"
      data-churn-risk={churnRisk !== null ? churnRisk : undefined}
      style={{ display: 'block' }}
    >
      <svg
        ref={svgRef}
        id="svg"
        className={clsx(isPlaying && 'playing')}
        viewBox="25 12 1610 418"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="상담 경로 재탐색 항법 맵"
        data-testid="journey-svg"
        style={{ display: 'block', width: '100%', height: '100%' }}
      >
        <SvgDefs />

        {/* 도트 배경 */}
        <rect x={0} y={0} width={1400} height={640} fill="url(#dots)"/>

        {/* 구간 프레임 */}
        <MapFrame />

        {/* 축 */}
        <AxisLines />

        {/* 저항 골짜기 언더글로 */}
        <g fill="var(--hazard)">
          {/* s1.json 10턴 축약 정합: 도달하는 MOT만(rate/compare/security). pay·avoid 제거. */}
          <ellipse className="hz" id="hz-rate"     cx={215}  cy={330} rx={46} ry={19}/>
          <ellipse className="hz" id="hz-compare"  cx={430}  cy={338} rx={46} ry={19}/>
          <ellipse className="hz" id="hz-security" cx={1205} cy={344} rx={46} ry={19}/>
        </g>

        {/* 경로 (ghost/route/routeInk/routeCore) */}
        <RoutePaths routeRef={routeRef} routeInkRef={routeInkRef} routeCoreRef={routeCoreRef} />

        {/* MOT 마커 (SSOT: .rz 그룹) */}
        <g fontFamily="var(--kr)" fontSize={18} fontWeight={800}>
          {markers.map((entry) => (
            <RzMarker
              key={entry.id}
              id={entry.id}
              markerState={entry.state}
              riskActive={isHighRisk}
            />
          ))}
        </g>

        {/* 체크포인트 노드 (능선) — 경로 위(전환가능 쪽)로 올려 차량 원과 겹치지 않게.
            차량은 경로(y≈178–232)를 달리고, cp(core r=42)는 cpCy+42 ≤ 경로y−38 이 되도록 배치. */}
        {/* s1.json 10턴 축약 정합: 도달하는 체크포인트만(시작·신뢰확보 + 목적지).
            조건이해/한도조회/신청검토 cp는 해당 턴이 삭제되어 제거. */}
        <g fontFamily="Pretendard,sans-serif" fontSize={19} fontWeight={800}>
          <CpNode id="cp-interest" x={70}   y={150} label="시작"/>
          <CpNode id="cp-trust"    x={575}  y={123} label="신뢰확보"/>
        </g>

        {/* 목적지 */}
        <CpNode id="cp-goal" x={1545} y={120} label="전환 GOAL" isGoal />

        {/* cautionPop (SSOT: #cautionPop) */}
        <CautionPop
          visible={activeCautionSeq !== null}
          x={cautionCoords.x}
          y={cautionCoords.y}
        />

        {/* 차량 (SSOT #carPos/#carBody) — 동그라미 안 더뉴그랜저, 회전 없이 위치만 이동 */}
        <g ref={carPosRef} id="carPos">
          <g ref={carBodyRef} id="carBody">
            <circle r={38} fill="#fff" stroke="var(--route)" strokeWidth={2.5} filter="url(#soft)" />
            <image
              href={CAR_IMAGE_HREF}
              x={-33}
              y={-33}
              width={66}
              height={66}
              preserveAspectRatio="xMidYMid slice"
              clipPath="url(#carClip)"
            />
            <circle r={33} fill="none" stroke="#fff" strokeWidth={1} />
          </g>
        </g>
      </svg>
    </section>
  );
});
