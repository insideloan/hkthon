// 카드② DB 분석 — SSOT docs/consult_redesigned-3.html DBDATA/DIAG (라인 1776–1846).
// custSeq(0–3)로 인덱싱 (상담 화면 10턴 축약 정합 — AI 콘텐츠 턴 4개).
//   DBDATA: 사용데이터(use=DB명 박스) + 분석결과(res=라인)
//   DIAG: 분석결과 도식 — nodes(원형 노드) + banner(요약). use와 중복 없이 '도출 지표'만.
// 박서준 데모 대본 갱신분: 4개 AI 응답 턴(custSeq 0~3)의 use/res/도식을
// 데모 시나리오 값으로 교체 — 금리비교 / ML금리 / 담보 / 비대면절차.
import type { DbDataEntry, DiagEntry } from '@/consult-engine/types';

export const DBDATA: DbDataEntry[] = [
  {
    // custSeq 0 — 타사 금리 비교 (금리 부담 위험 방어)
    use: ['금융사명 · 일자 · 잔액', '신용등급별 공시금리'],
    res: ['타사 16% · 납부이자 400만 → 자담 10% 전환 시 연 150만원 절감'],
  },
  {
    // custSeq 1 — 우량 고객 ML 금리 최적화 (조건 의심 위험 방어)
    use: ['우량 고객 (CB · 소득 · 부동산)', 'ML 금리 · 부도 민감도'],
    res: ['고소득 · 자가 / 금리민감 HIGH · 연체 LOW → 추가할인 100bp 여력'],
  },
  {
    // custSeq 2 — 담보 약관 (담보 오해 위험 방어)
    use: ['상품 약관 (담보 조건)'],
    res: ['저당권 설정형 담보 → 차량 점유 유지·운행 제약 없음'],
  },
  {
    // custSeq 3 — 대출 절차 (비대면 진행 안내)
    use: ['상품 약관 (대출 절차)', '비대면 전자약정 가능 여부'],
    res: ['고객 제출 서류 없이 비대면 진행'],
  },
];

export const DIAG: DiagEntry[] = [
  {
    // custSeq 0 — 타사 16% · 납부이자 400만 → 자담 10% 전환 시 연 150만원 절감
    nodes: [
      { val: '16%', label: '타사 금리', ic: '🔥', tone: 'hot' },
      { val: '400만', label: '납부 이자', ic: '🧾', tone: 'warn' },
      { val: '150만↓', label: '연 절감', ic: '💰', tone: 'go' },
    ],
    banner: { text: '타사 16% 확인 — 자담 10% 전환 시 연 150만원 절감', tone: 'ok' },
  },
  {
    // custSeq 1 — 고소득 · 자가 / 금리민감 HIGH · 연체 LOW → 추가할인 100bp 여력
    nodes: [
      { val: '자가 보유', label: '부동산', ic: '🏠', tone: 'route' },
      { val: 'HIGH', label: '금리 민감도', ic: '🎯', tone: 'go' },
      { val: '100bp', label: '추가할인 여력', ic: '📊', tone: 'go' },
    ],
    banner: { text: '고소득·자가 — 연체 LOW 확인, 추가할인 100bp 여력', tone: 'ok' },
  },
  {
    // custSeq 2 — 저당권 설정형 담보 → 차량 점유 유지 · 운행 제약 없음
    nodes: [
      { val: '저당권', label: '담보 방식', ic: '🚗', tone: 'go' },
      { val: '점유 유지', label: '차량 점유', ic: '🟢', tone: 'go' },
      { val: '제약 없음', label: '운행', ic: '✅', tone: 'go' },
    ],
    banner: { text: '저당권 설정형 담보 — 차량 점유 유지·운행 제약 없음', tone: 'ok' },
  },
  {
    // custSeq 3 — 고객 제출 서류 없이 비대면 진행
    nodes: [
      { val: '서류 0건', label: '고객 제출', ic: '📄', tone: 'go' },
      { val: '비대면', label: '진행 방식', ic: '📱', tone: 'go' },
      { val: '전자약정', label: '약정', ic: '✅', tone: 'route' },
    ],
    banner: { text: '고객 제출 서류 없이 비대면 전자약정 진행 가능', tone: 'ok' },
  },
];
