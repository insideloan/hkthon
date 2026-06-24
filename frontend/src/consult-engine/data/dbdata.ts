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
    use: ['담보 약관'],
    res: ['차량 점유 이전 없이 담보 설정 가능한 상품 여부 확인', '운행 유지 조건 검증'],
  },
  {
    use: ['심사 정책', '상품 승인 규칙'],
    res: ['고객 조건에 따른 승인 가능 범위 및 예상 금리·한도 제시', '심사 결과와 예상치 간 차이 범위 안내'],
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
      { val: '점유 유지', label: '담보 방식', ic: '🚗', tone: 'go' },
      { val: '운행 가능', label: '사용 제약', ic: '🟢', tone: 'go' },
    ],
    banner: { text: '운행 유지 담보 상품 — 사용 제약 없음', tone: 'ok' },
  },
  {
    nodes: [
      { val: '4,200만', label: '예상 한도', ic: '🏦', tone: 'route' },
      { val: '10~12%', label: '예상 금리', ic: '📊', tone: 'route' },
      { val: '±0.5%p', label: '편차 범위', ic: '📐', tone: 'warn' },
    ],
    banner: { text: '심사 결과 ↔ 예상치 차이 범위 고지', tone: 'ok' },
  },
];
