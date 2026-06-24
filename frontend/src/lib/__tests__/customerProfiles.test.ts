// customerProfiles — callId별 프로필 해석 + 인사말 이름 치환 단위 테스트.
import { describe, expect, it } from 'vitest';
import {
  resolveCustomerProfile,
  resolveScenarioCustomerName,
  SCENARIO_CUSTOMER_NAME,
} from '@/lib/customerProfiles';
import type { QueueRow } from '@/types/queue';

describe('resolveCustomerProfile', () => {
  it('데모 fixture가 있는 callId는 레코드별 프로필을 반환한다', () => {
    const p = resolveCustomerProfile('c-demo-07');
    expect(p.name).toBe('배수지');
    expect(p.loan).toContain('자동차담보');
    expect(p.needs.length).toBeGreaterThan(0);
    expect(p.nextAction).not.toBe('');
  });

  it('서로 다른 데모 행은 서로 다른 프로필을 반환한다(박서준 고정 아님)', () => {
    const a = resolveCustomerProfile('c-demo-06');
    const b = resolveCustomerProfile('c-demo-08');
    expect(a.name).toBe('오세훈');
    expect(b.name).toBe('윤재호');
    expect(a.loan).not.toBe(b.loan);
  });

  it('큐 행이 있으면 신원(이름·이탈위험)을 실제 레코드로 보정한다', () => {
    const row: QueueRow = { callId: 'c-demo-08', customerName: '윤재호', churnRisk: 88 };
    const p = resolveCustomerProfile('c-demo-08', row);
    expect(p.name).toBe('윤재호');
    expect(p.churnLabel).toBe('매우 높음'); // 88 → 매우 높음 (>=80)
    expect(p.churnVariant).toBe('hot');
  });

  it('알 수 없는 callId는 큐 행 신원만으로 폴백 프로필을 만든다', () => {
    const row: QueueRow = { callId: 'x-999', customerName: '신규고객', subtitle: '40세·KCB710', churnRisk: 20 };
    const p = resolveCustomerProfile('x-999', row);
    expect(p.name).toBe('신규고객');
    expect(p.genderAge).toBe('40세');
    expect(p.kcb).toBe('KCB 710');
    expect(p.loan).toBe('—'); // 금융 정보 미상
    expect(p.churnLabel).toBe('낮음'); // 20 → 낮음
  });

  it('큐 행도 fixture도 없으면 callId를 이름으로 쓰고 미상 처리', () => {
    const p = resolveCustomerProfile('unknown-id');
    expect(p.name).toBe('unknown-id');
    expect(p.kcb).toBe('—');
    expect(p.needs).toEqual([]);
  });
});

describe('resolveScenarioCustomerName', () => {
  it('데모 fixture 이름을 우선한다', () => {
    expect(resolveScenarioCustomerName('c-demo-01')).toBe('박서준');
    expect(resolveScenarioCustomerName('c-demo-09')).toBe('강예린');
  });

  it('fixture가 없으면 큐 행 이름을 쓴다', () => {
    const row: QueueRow = { callId: 'exp-123', customerName: '김체험' };
    expect(resolveScenarioCustomerName('exp-123', row)).toBe('김체험');
  });

  it('아무 정보도 없으면 기본값(박서준)으로 폴백해 기존 데모를 보존한다', () => {
    expect(resolveScenarioCustomerName('mock-cust-001')).toBe(SCENARIO_CUSTOMER_NAME);
  });
});
