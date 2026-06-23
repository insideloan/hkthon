// 카드② DB 분석 — SSOT docs/consult_redesigned-3.html DBDATA/DIAG (라인 1776–1846).
// custSeq(0–7)로 인덱싱.
//   DBDATA: 사용데이터(use=DB명 박스) + 분석결과(res=라인)
//   DIAG: 분석결과 도식 — nodes(원형 노드) + banner(요약). use와 중복 없이 '도출 지표'만.
import type { DbDataEntry, DiagEntry } from '@/consult-engine/types';

export const DBDATA: DbDataEntry[] = [
  {
    use: ['타사 대출 기관명', '잔액', '공시금리'],
    res: [
      '고객 신용점수에 맞는 타사 공시금리를 매핑하여 추정금리 산출',
      '현재 대출의 월 상환액 및 총 이자부담 계산 후 비교 가능 여부 판단',
    ],
  },
  {
    use: ['중도상환수수료 조건'],
    res: [
      '대출 실행일 기준 중도상환수수료 적용 여부 및 면제 시점 확인',
      '대환 시 비용 대비 절감 효과 분석',
    ],
  },
  {
    use: ['고객 심사한도', '예상금리', 'ML 모델 (반응확률·금리민감도·부도민감도)'],
    res: [
      '고객 승인 가능 한도·금리 확인 후 ML 오케스트레이션 수행',
      '금리민감도 기반 할인재원 (최대 50bp) 적용 가능 여부 검토',
      '부도위험도 확인 후 최적 금리 시뮬레이션 수행',
    ],
  },
  {
    use: ['추가 우대금리 가능 조건'],
    res: ['대출기간·거래실적·자동이체 등 우대조건 충족 여부 분석', '추가 금리 인하 가능 폭 산출'],
  },
  {
    use: ['담보 약관'],
    res: ['차량 점유 이전 없이 담보 설정 가능한 상품 여부 확인', '운행 유지 조건 검증'],
  },
  {
    use: ['고객 응대 이력', '상담 단계 정보'],
    res: ['거절 신호 및 관심도 분석', '신청 유도 대신 비교 상담 중심으로 대화 전략 전환'],
  },
  {
    use: ['심사 정책', '상품 승인 규칙'],
    res: ['고객 조건에 따른 승인 가능 범위 및 예상 금리·한도 제시', '심사 결과와 예상치 간 차이 범위 안내'],
  },
  {
    use: ['상품 적합도', '고객 세션'],
    res: ['상담원 핸드오프 적합 판정', '프로필·세션 인계 준비 완료'],
  },
];

export const DIAG: DiagEntry[] = [
  {
    nodes: [
      { val: '13%대', label: '현재 금리', ic: '🔥', tone: 'hot' },
      { val: '41.2만', label: '월 이자', ic: '🧾', tone: 'warn' },
      { val: '76만↓', label: '연 절감 여지', ic: '💰', tone: 'go' },
    ],
    banner: { text: '13%대 고금리 확인 — 대환 시 연 76만 절감 여지', tone: 'ok' },
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
    nodes: [
      { val: '4,200만', label: '승인 한도', ic: '🏦', tone: 'route' },
      { val: '50bp', label: '할인 재원', ic: '🎯', tone: 'go' },
      { val: '11.9%', label: '제안 금리', ic: '📊', tone: 'route' },
    ],
    banner: { text: '부도위험 내 최적 금리 시뮬레이션 완료', tone: 'ok' },
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
    nodes: [
      { val: '점유 유지', label: '담보 방식', ic: '🚗', tone: 'go' },
      { val: '운행 가능', label: '사용 제약', ic: '🟢', tone: 'go' },
    ],
    banner: { text: '운행 유지 담보 상품 — 사용 제약 없음', tone: 'ok' },
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
    nodes: [
      { val: '4,200만', label: '예상 한도', ic: '🏦', tone: 'route' },
      { val: '10~12%', label: '예상 금리', ic: '📊', tone: 'route' },
      { val: '±0.5%p', label: '편차 범위', ic: '📐', tone: 'warn' },
    ],
    banner: { text: '심사 결과 ↔ 예상치 차이 범위 고지', tone: 'ok' },
  },
  {
    nodes: [
      { val: '적합', label: '핸드오프 판정', ic: '✅', tone: 'go' },
      { val: '준비 완료', label: '세션 인계', ic: '📦', tone: 'route' },
    ],
    banner: { text: '상담원 핸드오프 준비 완료', tone: 'ok' },
  },
];
