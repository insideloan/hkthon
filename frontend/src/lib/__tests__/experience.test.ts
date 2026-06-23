// 체험 고객 생성 도메인 로직 테스트 — 신용점수/금리 규칙, 금액 포맷, 큐 행.
import { describe, expect, it } from 'vitest';
import {
  randomCreditScore, rateForCreditScore, formatAmountManwon,
  buildExperienceCustomer, experienceQueueRow,
  FIXED_CHURN_LABEL, FIXED_CHURN_RISK,
  type ExperienceForm,
} from '@/lib/experience';

describe('randomCreditScore', () => {
  it('always lands in 950–1000 inclusive', () => {
    // rng 경계값으로 양 끝 확인.
    expect(randomCreditScore(() => 0)).toBe(950);
    expect(randomCreditScore(() => 0.999999)).toBe(1000);
    // 다양한 rng 값에서 범위 보장.
    for (const r of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const s = randomCreditScore(() => r);
      expect(s).toBeGreaterThanOrEqual(950);
      expect(s).toBeLessThanOrEqual(1000);
    }
  });
});

describe('rateForCreditScore — 신용점수 반비례', () => {
  it('maps 950→4.50%, 1000→4.00% (높을수록 낮은 금리)', () => {
    expect(rateForCreditScore(950)).toBe(4.5);
    expect(rateForCreditScore(1000)).toBe(4.0);
  });

  it('is monotonically decreasing across the range', () => {
    let prev = Infinity;
    for (let s = 950; s <= 1000; s++) {
      const rate = rateForCreditScore(s);
      expect(rate).toBeLessThanOrEqual(prev);
      expect(rate).toBeGreaterThanOrEqual(4.0);
      expect(rate).toBeLessThanOrEqual(4.5);
      prev = rate;
    }
  });

  it('midpoint 975 → ~4.25%', () => {
    expect(rateForCreditScore(975)).toBeCloseTo(4.25, 2);
  });

  it('clamps out-of-range scores', () => {
    expect(rateForCreditScore(900)).toBe(4.5);
    expect(rateForCreditScore(1100)).toBe(4.0);
  });
});

describe('formatAmountManwon', () => {
  it('formats 만원 → 억 / 만 표기', () => {
    expect(formatAmountManwon(24000)).toBe('2.4억');
    expect(formatAmountManwon(50000)).toBe('5억');
    expect(formatAmountManwon(3000)).toBe('3,000만');
    expect(formatAmountManwon(0)).toBe('0');
  });
});

describe('buildExperienceCustomer', () => {
  const form: ExperienceForm = {
    name: '홍길동', gender: '남', age: 45,
    loanType: '주택담보대출', loanAmount: 24000,
    assetType: '아파트', assetAmount: 52000,
  };

  it('assigns credit/rate by rule and fixes churn=낮음', () => {
    const c = buildExperienceCustomer(form, 12345, () => 0.5);
    expect(c.creditScore).toBeGreaterThanOrEqual(950);
    expect(c.creditScore).toBeLessThanOrEqual(1000);
    // 금리는 배정된 신용점수와 정합(반비례 규칙).
    expect(c.rate).toBe(rateForCreditScore(c.creditScore));
    expect(c.churnLabel).toBe(FIXED_CHURN_LABEL);
    // 입력값 보존.
    expect(c.name).toBe('홍길동');
    expect(c.callId).toBe('exp-12345');
  });
});

describe('experienceQueueRow', () => {
  it('produces a top-of-queue 발신중(DIALING) row with low churn', () => {
    const c = buildExperienceCustomer(
      { name: '김체험', gender: '여', age: 33, loanType: '없음', loanAmount: 0, assetType: '없음', assetAmount: 0 },
      999, () => 0.2,
    );
    const row = experienceQueueRow(c);
    expect(row.state).toBe('DIALING');
    expect(row.customerName).toBe('김체험');
    expect(row.churnRisk).toBe(FIXED_CHURN_RISK);
    expect(row.callId).toBe('exp-999');
  });
});
