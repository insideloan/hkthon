// 체험(experience) 고객 생성 — 관리자 화면 "체험" 버튼 플로우 도메인 로직.
//
// 관리자가 모달에서 고객 정보를 입력하면(이름/성별/나이/보유대출+금액/자산+금액),
// 여기서 신용점수·현 금리를 규칙대로 배정하고 고객 레코드 + 큐 행을 만든다.
// 데모(mock) 모드에서는 큐 스토어에 prepend 되어 발신중(DIALING)으로 노출된다.
// 저장 형상은 상담 CRM 고객 프로필(crm/[id]/page.tsx PROFILE_KV)과 정합.
import type { QueueRow } from '@/types/queue';

// ── 입력 옵션 (상담 CRM 프로필 필드 기준) ────────────────────────────────────
export const GENDERS = ['남', '여'] as const;
export type Gender = (typeof GENDERS)[number];

// 보유대출 종류 — 주택담보/자동차담보/신용/없음 중 택1.
export const LOAN_TYPES = ['주택담보대출', '자동차담보대출', '신용대출', '없음'] as const;
export type LoanType = (typeof LOAN_TYPES)[number];

// 자산 종류 — 아파트/상가/건물/토지/자동차/없음 중 택1.
export const ASSET_TYPES = ['아파트', '상가', '건물', '토지', '자동차', '없음'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

// 이탈 위험은 체험 고객 고정값(낮음). 큐의 churnRisk(0~100)로는 낮은 수치로 매핑.
export const FIXED_CHURN_LABEL = '낮음';
export const FIXED_CHURN_RISK = 12;

// ── 모달 입력 폼 값 ───────────────────────────────────────────────────────────
export type ExperienceForm = {
  name: string;
  gender: Gender;
  age: number;
  loanType: LoanType;
  /** 보유대출 금액(만원). loanType이 '없음'이면 무시. */
  loanAmount: number;
  assetType: AssetType;
  /** 자산 금액(만원). assetType이 '없음'이면 무시. */
  assetAmount: number;
};

// ── 신용점수 / 현 금리 배정 규칙 ──────────────────────────────────────────────
// 신용점수: 950~1000 사이 랜덤. 현 금리: 4.0~4.5% 사이, 신용점수와 반비례
// (점수 높을수록 금리 낮음). 950→4.50%, 1000→4.00% 로 선형 매핑.
const CREDIT_MIN = 950;
const CREDIT_MAX = 1000;
const RATE_MIN = 4.0; // 최고 신용점수(1000)의 금리
const RATE_MAX = 4.5; // 최저 신용점수(950)의 금리

/** [min, max] 정수 균등 랜덤. rng 주입 가능(테스트 결정성). */
export function randomCreditScore(rng: () => number = Math.random): number {
  return CREDIT_MIN + Math.floor(rng() * (CREDIT_MAX - CREDIT_MIN + 1));
}

/**
 * 신용점수(950~1000)를 현 금리(4.0~4.5%)로 반비례 선형 매핑.
 * 점수가 높을수록 낮은 금리. 범위를 벗어난 입력도 클램프한다.
 */
export function rateForCreditScore(creditScore: number): number {
  const clamped = Math.max(CREDIT_MIN, Math.min(CREDIT_MAX, creditScore));
  const t = (clamped - CREDIT_MIN) / (CREDIT_MAX - CREDIT_MIN); // 0(950)~1(1000)
  const rate = RATE_MAX - t * (RATE_MAX - RATE_MIN); // 950→4.5, 1000→4.0
  return Math.round(rate * 100) / 100; // 소수 둘째 자리
}

// ── 금액 포맷 (만원 단위 입력 → 억/만원 표시) ─────────────────────────────────
/** 만원 단위 정수 → "2.4억" / "3,000만" 표시 문자열. */
export function formatAmountManwon(manwon: number): string {
  if (!manwon || manwon <= 0) return '0';
  if (manwon >= 10_000) {
    const eok = manwon / 10_000;
    // 정수면 "2억", 아니면 소수 한 자리 "2.4억"
    const label = Number.isInteger(eok) ? `${eok}` : eok.toFixed(1);
    return `${label}억`;
  }
  return `${manwon.toLocaleString('en-US')}만`;
}

// ── 생성된 체험 고객 ──────────────────────────────────────────────────────────
export type ExperienceCustomer = {
  customerId: string;
  callId: string;
  name: string;
  gender: Gender;
  age: number;
  loanType: LoanType;
  loanAmount: number;
  assetType: AssetType;
  assetAmount: number;
  creditScore: number;
  /** 현 금리(%) — 신용점수 반비례. */
  rate: number;
  churnLabel: string;
};

/**
 * 폼 입력 → 체험 고객 레코드. 신용점수/금리를 규칙대로 배정한다.
 * id 충돌을 피하려고 호출자가 고유 시드(ts)를 넘긴다(Date.now 미사용 — 테스트 결정성).
 */
export function buildExperienceCustomer(
  form: ExperienceForm,
  seed: number,
  rng: () => number = Math.random,
): ExperienceCustomer {
  const creditScore = randomCreditScore(rng);
  const rate = rateForCreditScore(creditScore);
  return {
    customerId: `exp-${seed}`,
    callId: `exp-${seed}`,
    name: form.name,
    gender: form.gender,
    age: form.age,
    loanType: form.loanType,
    loanAmount: form.loanAmount,
    assetType: form.assetType,
    assetAmount: form.assetAmount,
    creditScore,
    rate,
    churnLabel: FIXED_CHURN_LABEL,
  };
}

/**
 * 체험 고객 → 큐 행(발신중). 표 최상단에 prepend 되어 DIALING 으로 노출된다.
 * stage 는 박서준 데모와 동일한 '사전 고객분석'으로 두지 않는다(그건 세그먼트
 * 화면으로 라우팅되는 데모 전용 키). 체험 행은 '발신 대기' 단계로 표시.
 */
export function experienceQueueRow(c: ExperienceCustomer): QueueRow {
  return {
    callId: c.callId,
    customerName: c.name,
    state: 'DIALING',
    stage: '발신 대기',
    churnRisk: FIXED_CHURN_RISK,
    assignee: 'AI 코파일럿',
    channel: '아웃바운드',
    elapsedSec: 0,
    highlight: null,
  };
}
