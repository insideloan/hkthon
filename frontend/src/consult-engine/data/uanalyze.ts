// 카드① 발화별 분석 — SSOT docs/consult_redesigned-3.html UANALYZE (라인 1732–1773).
// custSeq(0–7)로 인덱싱. 각 발화의 psy/intent/obstacle 구슬 + 참고 전략 인덱스.
//   frag = 구슬에 담길 고객 발화 조각. tone:'easing'|'pos' → 완화/해소(초록)
import type { UAnalyzeEntry } from '@/consult-engine/types';

export const UANALYZE: UAnalyzeEntry[] = [
  {
    // 0 대출 거부
    psy: { dim: '무관심', frag: '전화면 안 받아요' },
    intent: { dim: '연락중단', frag: '근데 (빨리 끊기)' },
    obstacle: { dim: '대출거부', frag: '대출 전화' },
    strat: 2,
  },
  {
    // 1 불신·조건 의심
    psy: { dim: '의심', frag: '결국 갈아타라는' },
    intent: { dim: '금리비교', frag: '해보면 조건 다를' },
    obstacle: { dim: '금리확인후판단', frag: '조건 다를 수도' },
    strat: 0,
  },
  {
    // 2 더 낮아질 수 있냐 (기대)
    psy: { dim: '기대', frag: '13%대 쓰고 있긴' },
    intent: { dim: '월납입절감', frag: '더 낮아질 수 있어요?' },
    obstacle: { dim: '월납입확인후판단', frag: '그거보다', tone: 'easing' },
    strat: 3,
  },
  {
    // 3 차이 작다 (가격 저항)
    psy: { dim: '회의', frag: '생각보다 큰 차이는' },
    intent: { dim: '금리비교', frag: '큰 차이는 아니네요' },
    obstacle: { dim: '기존대출비교후판단', frag: '차이는 아니네요' },
    strat: 5,
  },
  {
    // 4 담보 오해 (불안)
    psy: { dim: '불안', frag: '자동차 운행 못 하는거 아니에요?' },
    intent: { dim: '안전성확인', frag: '담보요? 그런거 하다가' },
    obstacle: { dim: '설명추가필요', frag: '운행 못 하는거' },
    strat: 1,
  },
  {
    // 5 담보 거부 (이탈 임박)
    psy: { dim: '거부감', frag: '불편해지는 건 싫은데요' },
    intent: { dim: '상환조건', frag: '괜히 담보 잡혔다가' },
    obstacle: { dim: '상품부적합', frag: '불편해지는 건' },
    strat: 7,
  },
  {
    // 6 확인만 해보자 (수용, 서류 번거로움 우려)
    psy: { dim: '수용', frag: '그럼 확인만 해볼게요', tone: 'easing' },
    intent: { dim: '대환가능성', frag: '빠르게 해줄수 있는거죠?' },
    obstacle: { dim: '절차간소화필요', frag: '서류내고 귀찮은건 싫은데' },
    strat: 6,
  },
  {
    // 7 상담원 연결 (전환)
    psy: { dim: '안도', frag: '상담원 연결해주세요', tone: 'pos' },
    intent: { dim: '대환가능성', frag: '연결해주세요', tone: 'pos' },
    obstacle: { dim: '상담원연결필요', frag: '우려 해소', tone: 'pos' },
    strat: 8,
  },
];
