// 카드② DB 분석 — SSOT docs/consult_redesigned-3.html DBDATA/DIAG (라인 1776–1846).
// custSeq(0–7)로 인덱싱.
//   DBDATA: 사용데이터(use=DB명 박스) + 분석결과(res=라인)
//   DIAG: 분석결과 도식 — nodes(원형 노드) + banner(요약). use와 중복 없이 '도출 지표'만.
// 박서준 데모 대본 갱신분: AI 응답 턴 3/5/7/11에 대응하는 분석 슬롯
// (custSeq 0·2·4·6)의 use/res를 데모 시나리오 값으로 교체.
import type { DbDataEntry, DiagEntry } from '@/consult-engine/types';

export const DBDATA: DbDataEntry[] = [
  {
    // 턴 3 — 타사 금리 비교 (금리 부담 위험 방어)
    use: ['금융사명 · 일자 · 잔액', '신용등급별 공시금리'],
    res: ['타사 13% · 납부이자 143만 → 자담 10% 전환 시 연 34만원 절감'],
  },
  {
    use: ['중도상환수수료 조건'],
    res: [
      '대출 실행일 기준 중도상환수수료 적용 여부 및 면제 시점 확인',
      '대환 시 비용 대비 절감 효과 분석',
    ],
  },
  {
    // 턴 5 — 우량 고객 ML 금리 최적화 (가격 저항 위험 방어)
    use: ['우량 고객 (CB · 소득)', 'ML 금리 · 부도 민감도'],
    res: ['CB 2등급·고소득 / 금리민감 HIGH · 연체 LOW → 추가할인 100bp 여력'],
  },
  {
    use: ['추가 우대금리 가능 조건'],
    res: ['대출기간·거래실적·자동이체 등 우대조건 충족 여부 분석', '추가 금리 인하 가능 폭 산출'],
  },
  {
    // 턴 7 — 담보 약관 (담보 오해 위험 방어)
    use: ['상품 약관 (담보 조건)'],
    res: ['저당권 설정형 담보 → 차량 점유 유지·운행 제약 없음'],
  },
  {
    use: ['고객 응대 이력', '상담 단계 정보'],
    res: ['거절 신호 및 관심도 분석', '신청 유도 대신 비교 상담 중심으로 대화 전략 전환'],
  },
  {
    // 턴 11 — 대출 절차 (비대면 진행 안내)
    use: ['상품 약관 (대출 절차)', '비대면 전자약정 가능 여부'],
    res: ['고객 제출 서류 없이 비대면 진행'],
  },
  {
    use: ['상품 적합도', '고객 세션'],
    res: ['상담원 핸드오프 적합 판정', '프로필·세션 인계 준비 완료'],
  },
];

export const DIAG: DiagEntry[] = [
  {
    // 턴 3 — 타사 13% · 납부이자 143만 → 자담 10% 전환 시 연 34만원 절감
    nodes: [
      { val: '13%', label: '타사 금리', ic: '🔥', tone: 'hot' },
      { val: '143만', label: '납부 이자', ic: '🧾', tone: 'warn' },
      { val: '34만↓', label: '연 절감', ic: '💰', tone: 'go' },
    ],
    banner: { text: '타사 13% 확인 — 자담 10% 전환 시 연 34만원 절감', tone: 'ok' },
  },
  {
    nodes: [
      { val: '45.6만', label: '중도상환', ic: '💳', tone: 'warn' },
      { val: '114만', label: '연 절감', ic: '📉', tone: 'go' },
      { val: '1년 내', label: '비용 회수', ic: '⏱️', tone: 'route' },
    ],
    banner: { text: '비용 대비 절감 우위 — 대환 권장', tone: 'ok' },
  },
  {
    // 턴 5 — CB 2등급·고소득 / 금리민감 HIGH · 연체 LOW → 추가할인 100bp 여력
    nodes: [
      { val: 'CB 2등급', label: '신용 등급', ic: '🏦', tone: 'route' },
      { val: 'HIGH', label: '금리 민감도', ic: '🎯', tone: 'go' },
      { val: '100bp', label: '추가할인 여력', ic: '📊', tone: 'go' },
    ],
    banner: { text: '우량 고객 — 연체 LOW 확인, 추가할인 100bp 여력', tone: 'ok' },
  },
  {
    nodes: [
      { val: '3종', label: '우대 충족', ic: '✅', tone: 'route' },
      { val: '−0.7%p', label: '인하 폭', ic: '⬇️', tone: 'go' },
      { val: '10.9%', label: '예상 금리', ic: '🎉', tone: 'go' },
    ],
    banner: { text: '우대 적용 시 10%대 진입 가능', tone: 'ok' },
  },
  {
    // 턴 7 — 저당권 설정형 담보 → 차량 점유 유지 · 운행 제약 없음
    nodes: [
      { val: '저당권', label: '담보 방식', ic: '🚗', tone: 'go' },
      { val: '점유 유지', label: '차량 점유', ic: '🟢', tone: 'go' },
      { val: '제약 없음', label: '운행', ic: '✅', tone: 'go' },
    ],
    banner: { text: '저당권 설정형 담보 — 차량 점유 유지·운행 제약 없음', tone: 'ok' },
  },
  {
    nodes: [
      { val: '62%', label: '이탈 위험', ic: '⚠️', tone: 'hot' },
      { val: '3회', label: '거절 신호', ic: '🙅', tone: 'warn' },
      { val: '자율성', label: '권장 전략', ic: '🧭', tone: 'route' },
    ],
    banner: { text: '이탈 임박 — 비교 상담 모드 전환 권장', tone: 'alert' },
  },
  {
    // 턴 11 — 고객 제출 서류 없이 비대면 진행
    nodes: [
      { val: '서류 0건', label: '고객 제출', ic: '📄', tone: 'go' },
      { val: '비대면', label: '진행 방식', ic: '📱', tone: 'go' },
      { val: '전자약정', label: '약정', ic: '✅', tone: 'route' },
    ],
    banner: { text: '고객 제출 서류 없이 비대면 전자약정 진행 가능', tone: 'ok' },
  },
  {
    nodes: [
      { val: '적합', label: '핸드오프 판정', ic: '✅', tone: 'go' },
      { val: '준비 완료', label: '세션 인계', ic: '📦', tone: 'route' },
    ],
    banner: { text: '상담원 핸드오프 준비 완료', tone: 'ok' },
  },
];
