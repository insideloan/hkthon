// 고객 프로필 fixture — 큐 레코드(callId)별 신원·프로필 데이터.
//
// 배경: 큐 wire(QueueRow)에는 이름·subtitle("38세·KCB744")·이탈위험만 있고,
// CRM 상세에 필요한 보유대출·금리·자산·핵심니즈는 wire에 없다(박서준만 하드코딩
// 되어 있었음). 데모 행(c-demo-*)에 한해 레코드별 프로필을 여기 fixture로 채우고,
// 알 수 없는 callId는 큐 행에서 신원만 추출해 일반 프로필로 폴백한다.
//
// 신원(이름·나이·KCB·이탈위험)은 가능한 한 실제 큐 레코드에서 끌어오고, 금융 프로필
// (대출·금리·자산·니즈)은 데모용 fixture다. 대화 흐름(시나리오) 자체는 공용이다.
import type { QueueRow } from '@/types/queue';
import { formatAmountManwon, type ExperienceCustomer } from '@/lib/experience';

export type ProfileVariant = '' | 'hot' | 'ok' | 'warn';
export type CustomerNeed = { label: string; variant: ProfileVariant };
export type FlowStepText = { stage: string; tx: string };

export type CustomerProfile = {
  /** 고객 이름 (AI 상담 인사말 + CRM 프로필 공용). */
  name: string;
  /** "남 · 38세" 형태 표기. 성별은 데모 fixture 값(폴백 시 나이만). */
  genderAge: string;
  /** "KCB 744". */
  kcb: string;
  loan: string;
  rate: string;
  rateVariant: ProfileVariant;
  asset: string;
  churnLabel: string;
  churnVariant: ProfileVariant;
  needs: CustomerNeed[];
  /** 권장 다음 액션(▶ 권장). */
  nextAction: string;
};

// ── 데모 행 fixture (callId 키) ───────────────────────────────────────────────
// 신원은 큐 행과 일치시키고, 금융 프로필·니즈는 각 행의 stage/이탈위험 서사에 맞춘
// 데모용 값이다.
const DEMO_PROFILES: Record<string, CustomerProfile> = {
  'c-demo-01': {
    name: '박서준',
    genderAge: '남 · 38세',
    kcb: 'KCB 744',
    loan: '주택담보대출 2.4억',
    rate: '4.85%',
    rateVariant: 'hot',
    asset: '아파트 5.2억',
    churnLabel: '낮음',
    churnVariant: 'ok',
    needs: [
      { label: '금리 인하 요구권', variant: '' },
      { label: '조기 상환 우려', variant: 'warn' },
      { label: '타행 이관 검토 중', variant: 'warn' },
      { label: '장기 고객 우대 희망', variant: 'ok' },
    ],
    nextAction: '우대금리 0.3%p 적용 제안 → 금리 인하 요구권 안내',
  },
  'c-demo-06': {
    name: '오세훈',
    genderAge: '남 · 41세',
    kcb: 'KCB 745',
    loan: '신용대출 3,200만',
    rate: '11.8%',
    rateVariant: 'hot',
    asset: '전세보증금 2.1억',
    churnLabel: '낮음',
    churnVariant: 'ok',
    needs: [
      { label: '대환 금리 비교', variant: '' },
      { label: '문자 안내 수신 동의', variant: 'ok' },
      { label: '서류 간소화 희망', variant: 'warn' },
    ],
    nextAction: '대환 견적 문자 발송 완료 → 재상담 예약 제안',
  },
  'c-demo-07': {
    name: '배수지',
    genderAge: '여 · 36세',
    kcb: 'KCB 733',
    loan: '자동차담보대출 1,800만',
    rate: '9.9%',
    rateVariant: '',
    asset: '차량 시세 3,400만',
    churnLabel: '낮음',
    churnVariant: 'ok',
    needs: [
      { label: '대출 접수 완료', variant: 'ok' },
      { label: '한도 상향 관심', variant: '' },
      { label: '상환 일정 조정', variant: 'warn' },
    ],
    nextAction: '대출 접수 완료 → 심사 진행 상황 안내 + 상담사 연결',
  },
  'c-demo-08': {
    name: '윤재호',
    genderAge: '남 · 48세',
    kcb: 'KCB 695',
    loan: '자동차담보대출 2,600만',
    rate: '13.4%',
    rateVariant: 'hot',
    asset: '차량 공동명의(배우자)',
    churnLabel: '높음',
    churnVariant: 'hot',
    needs: [
      { label: '차량 공동명의 제약', variant: 'warn' },
      { label: '담보 설정 거부감', variant: 'warn' },
      { label: '배우자 동의 필요', variant: 'warn' },
    ],
    nextAction: '공동명의 동의 절차 안내 → 신용대환 대안 재제시',
  },
  'c-demo-09': {
    name: '강예린',
    genderAge: '여 · 27세',
    kcb: 'KCB 710',
    loan: '신용대출 900만',
    rate: '15.2%',
    rateVariant: 'hot',
    asset: '재직 1년 차',
    churnLabel: '매우 높음',
    churnVariant: 'hot',
    needs: [
      { label: 'TM 수신 거부', variant: 'warn' },
      { label: '연락 자제 요청', variant: 'warn' },
      { label: '온라인 비대면 선호', variant: '' },
    ],
    nextAction: '수신 거부 등록 → 비대면 채널(앱/웹) 안내로 전환',
  },
};

// ── subtitle 파서 ─────────────────────────────────────────────────────────────
// "38세·KCB744" → { age: '38', kcb: '744' }. 형식이 어긋나도 안전하게 부분 파싱.
function parseSubtitle(subtitle: string | null | undefined): { age?: string; kcb?: string } {
  if (!subtitle) return {};
  const age = subtitle.match(/(\d+)\s*세/)?.[1];
  const kcb = subtitle.match(/KCB\s*(\d+)/i)?.[1];
  return { age, kcb };
}

// 이탈위험(0~100) → 라벨 + variant.
function churnFrom(risk: number | null | undefined): { label: string; variant: ProfileVariant } {
  if (typeof risk !== 'number') return { label: '—', variant: '' };
  if (risk >= 80) return { label: '매우 높음', variant: 'hot' };
  if (risk >= 55) return { label: '높음', variant: 'hot' };
  if (risk >= 35) return { label: '보통', variant: 'warn' };
  return { label: '낮음', variant: 'ok' };
}

// 알 수 없는 callId 폴백: 큐 행 신원만으로 일반 프로필 구성(금융 항목은 미상 표기).
function fallbackProfile(callId: string, row?: QueueRow): CustomerProfile {
  const { age, kcb } = parseSubtitle(row?.subtitle);
  const churn = churnFrom(row?.churnRisk);
  return {
    name: row?.customerName || callId,
    genderAge: age ? `${age}세` : '—',
    kcb: kcb ? `KCB ${kcb}` : '—',
    loan: '—',
    rate: '—',
    rateVariant: '',
    asset: '—',
    churnLabel: churn.label,
    churnVariant: churn.variant,
    needs: [],
    nextAction: '상담 이력 확인 후 다음 액션 제안',
  };
}

// ── 체험 고객 → 프로필 ────────────────────────────────────────────────────────
// 모달 입력값(이름·성별·나이·대출·자산)과 자동 배정값(신용점수·금리)으로 CRM 프로필을
// 구성한다. 보유대출/자산이 '없음'이면 그대로 '없음' 표기. 이탈위험은 체험 고정(낮음).
export function profileFromExperience(c: ExperienceCustomer): CustomerProfile {
  const loan =
    c.loanType === '없음' ? '없음' : `${c.loanType} ${formatAmountManwon(c.loanAmount)}`;
  const asset =
    c.assetType === '없음' ? '없음' : `${c.assetType} ${formatAmountManwon(c.assetAmount)}`;
  return {
    name: c.name,
    genderAge: `${c.gender} · ${c.age}세`,
    kcb: `KCB ${c.creditScore}`,
    loan,
    rate: `${c.rate.toFixed(2)}%`,
    rateVariant: '',
    asset,
    churnLabel: c.churnLabel,
    churnVariant: 'ok',
    needs: [
      { label: '체험 상담 고객', variant: '' },
      { label: '금리 비교 요청', variant: '' },
    ],
    nextAction: '입력 정보 기반 맞춤 금리 비교 → 상담사 연결 제안',
  };
}

/**
 * callId(+선택적 큐 행/체험 고객)로 고객 프로필을 해석한다.
 * 우선순위: 체험 고객(exp-*) > 데모 fixture > 큐 행 신원 폴백.
 */
export function resolveCustomerProfile(
  callId: string,
  row?: QueueRow,
  experience?: ExperienceCustomer,
): CustomerProfile {
  if (experience) return profileFromExperience(experience);
  const fixture = DEMO_PROFILES[callId];
  if (!fixture) return fallbackProfile(callId, row);
  // fixture 우선. 단, 큐 행에 신원 값이 있으면(이름/이탈위험) 실제 레코드로 보정.
  const churn = row?.churnRisk != null ? churnFrom(row.churnRisk) : null;
  return {
    ...fixture,
    name: row?.customerName || fixture.name,
    churnLabel: churn?.label ?? fixture.churnLabel,
    churnVariant: churn?.variant ?? fixture.churnVariant,
  };
}

/** AI 상담 인사말 등에서 치환할 시나리오 원본의 고객 이름(고정 토큰). */
export const SCENARIO_CUSTOMER_NAME = '박서준';

/**
 * AI 상담 화면에서 인사말에 넣을 고객 이름을 해석한다.
 * 체험 고객 → fixture(데모 행) → 큐 행 이름 → 기본값(박서준) 순. 데모 경로(callId가
 * 큐 행/fixture에 없는 mock-* 등)는 기본값을 유지해 기존 시연이 깨지지 않는다.
 */
export function resolveScenarioCustomerName(
  callId: string,
  row?: QueueRow,
  experience?: ExperienceCustomer,
): string {
  return (
    experience?.name || DEMO_PROFILES[callId]?.name || row?.customerName || SCENARIO_CUSTOMER_NAME
  );
}
