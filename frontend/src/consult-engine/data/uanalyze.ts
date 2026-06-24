// 카드① 발화별 분석 — s1.json 10턴 축약 정합. custSeq(0–3)로 인덱싱.
//   frag = 구슬에 담길 고객 발화 조각. tone:'easing'|'pos' → 완화/해소(초록)
//   각 항목은 s1.json 고객 턴(seq2/4/6/8)의 감정/니즈/이용가능성/전략과 정합.
import type { UAnalyzeEntry } from '@/consult-engine/types';

export const UANALYZE: UAnalyzeEntry[] = [
  {
    // 0 대출 거부 (s1.json seq2: 거부감/연락중단/대출거부)
    psy: { dim: '거부감', frag: '전화면 안 받아요' },
    intent: { dim: '연락중단', frag: '근데 (빨리 끊기)' },
    obstacle: { dim: '대출거부', frag: '대출 전화' },
    strat: 0,
  },
  {
    // 1 불신·조건 의심 (s1.json seq4: 의심/대환가능성/기존대출비교후판단)
    psy: { dim: '의심', frag: '결국 갈아타라는' },
    intent: { dim: '대환가능성', frag: '해보면 조건 다를' },
    obstacle: { dim: '기존대출비교후판단', frag: '조건 다를 수도' },
    strat: 3,
  },
  {
    // 2 담보 오해 (불안) (s1.json seq6: 불안/상품확인/설명추가필요)
    psy: { dim: '불안', frag: '자동차 운행 못 하는거 아니에요?' },
    intent: { dim: '상품확인', frag: '담보요? 그런거 하다가' },
    obstacle: { dim: '설명추가필요', frag: '운행 못 하는거' },
    strat: 5,
  },
  {
    // 3 확인만 해보자 (수용, 서류 번거로움 우려) (s1.json seq8: 수용/절차서류/AI접수필요)
    psy: { dim: '수용', frag: '그럼 확인만 해볼게요', tone: 'easing' },
    intent: { dim: '절차/서류', frag: '빠르게 해줄수 있는거죠?' },
    obstacle: { dim: 'AI접수필요', frag: '서류내고 귀찮은건 싫은데' },
    strat: 20,
  },
];
