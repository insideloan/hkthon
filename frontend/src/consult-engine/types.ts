// SSOT 시나리오 엔진 타입 — docs/consult_redesigned-3.html <script>(1324–2495)의
// 순수 데이터 구조를 TS로 옮긴 것. 엔진(useConsultEngine)과 데이터 모듈이 공유한다.
// 원본 키 이름을 그대로 보존한다(검증·대조 용이).

// ── 발화 키워드 강조 ──────────────────────────────────────────────────────
// 문자열이면 단순 강조, 객체면 r=위험(빨강)/g=긍정(초록) 키워드.
export type Kw = string | { w: string; r?: 1; g?: 1 };

export type BannerType = 'def' | 'risk' | 'done';

// 네비 배너 — 여정맵 상단. eye=eyebrow, lead=본문(HTML 허용).
export interface BannerContent {
  type: BannerType;
  eye: string;
  lead: string;
}

// 다음 수 3채널 — t:발화전략 / d:DB조회 / a:분석, pick:채택 채널, block:막힌 채널.
export interface NextMove {
  t: string;
  d: string;
  a: string;
  pick: 'a' | 't' | 'd';
  block?: string;
}

// 고객 발화의 즉석 분석(STT 표시용). tone r=위험/g=긍정.
export interface TurnAnalysis {
  voice: string;
  emo: string;
  tone: 'r' | 'g';
  intent: string;
}

// 고객 발화가 트리거하는 DB 조회 카드(STT an 영역). use/res와 별개의 인라인 표.
export interface InlineDb {
  nm: string;
  cols: string[];
  q: string;
  r: string[];
}

// 이탈 위험 이벤트 — rz는 여정맵 위험노드 id 접미사(rate/compare/pay/security/avoid).
export interface RiskEvent {
  n: number;
  label: string;
  rz: string;
  prob: number;
}

// AI 발화의 방어 — 직전 위험노드(rz)를 막고 이탈확률을 낮춤.
export interface DefenseEvent {
  tac: string;
  rz: string;
  prob: number;
}

// 시나리오 한 턴(S[] 원소). 18턴.
export interface ScenarioEntry {
  who: 'ai' | 'cust';
  txt: string;
  kw?: Kw[];
  prog?: number; // 0–1, 경로상 차량 위치
  cp?: string; // 도달 체크포인트 id (interest/trust/cond/limit/review/goal)
  prob?: number; // 이탈 확률(%)
  last?: true;
  // 아웃바운드 콜 연결 시 고객이 먼저 받는 인사("여보세요?"). 분석 파이프라인을
  // 트리거하지 않으며 custSeq(발화분석 인덱스)도 소비하지 않는다 — 가벼운 인사라
  // 심리/DB/컴플라이언스 카드를 돌릴 발화가 아니기 때문.
  greet?: true;
  // 고객 턴 전용
  an?: TurnAnalysis;
  db?: InlineDb[];
  risk?: RiskEvent;
  an_line?: string;
  // AI 턴 전용
  def?: DefenseEvent;
  // 공통
  nx: NextMove;
  bann?: BannerContent;
}

// 여정 단계(JOURNEY[]). 8단계.
export interface JourneyStep {
  label: string;
  warn: boolean;
}

// ── 카드① 발화분석 ────────────────────────────────────────────────────────
// orb 한 개 — bin(psy/intent/obstacle) 슬롯에 떨어지는 구슬.
export interface OrbEntry {
  dim: string; // 표시 라벨(= DIM 화이트리스트 키)
  frag: string; // 구슬에 담길 고객 발화 조각
  tone?: 'easing' | 'pos'; // 완화/해소(초록)
}

// 발화별 분석(UANALYZE[]). custSeq(0–7)로 인덱싱.
export interface UAnalyzeEntry {
  psy: OrbEntry;
  intent: OrbEntry;
  obstacle: OrbEntry;
  strat: number; // STRAT20 인덱스(참고용; pickStrategies는 NEED/EMO/AVAIL_STRAT 사용)
}

// 카테고리 라벨(CATS).
export interface CategoryLabel {
  label: string;
  en: string;
}

// 대표 전략(STRAT20[]). 20종 + AI 접수 전환 전략 = 21장.
export interface Strategy {
  name: string;
  lead: string;
}

// ── 카드② DB 분석 ─────────────────────────────────────────────────────────
// 사용데이터(use=DB명) + 분석결과(res=라인). DBDATA[].
export interface DbDataEntry {
  use: string[];
  res: string[];
}

// 분석결과 도식 노드(DIAG[].nodes).
export interface DiagNode {
  val: string;
  label: string;
  ic: string;
  tone: 'hot' | 'warn' | 'go' | 'route';
}

// 분석결과 도식(DIAG[]).
export interface DiagEntry {
  nodes: DiagNode[];
  banner: { text: string; tone: 'ok' | 'alert' };
}

// ── 카드③ 컴플라이언스 ────────────────────────────────────────────────────
// 최종 발화 diff 세그먼트: {t}=변경없음 / {del,ins}=교체 / {ins,add}=신규추가.
export type FinalSeg =
  | { t: string }
  | { del: string; ins: string }
  | { ins: string; add: true };

// 컴플라이언스 한 턴(COMPLY[]). custSeq로 인덱싱.
export interface ComplyEntry {
  draftHtml: string; // 가안(HTML, <span class="risk"> 강조 포함)
  flags: [boolean, boolean, boolean, boolean]; // 4규제 위반 여부
  final: FinalSeg[];
}

// 컴플라이언스 규제 정의(COMPLIANCE[]). 4종.
export interface ComplianceRule {
  law: string;
  desc: string;
}
