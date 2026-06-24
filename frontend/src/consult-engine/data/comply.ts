// 카드③ 컴플라이언스 — SSOT docs/consult_redesigned-3.html COMPLY/COMPLIANCE (라인 1343–1348, 1850–1901).
//   COMPLIANCE: 규제 4종 (카드③에서 세로 1→4 체크)
//   COMPLY: 가안(draftHtml) → 4규제(flags) → 최종(final diff). custSeq로 인덱싱.
//     final 세그먼트: {t} 변경없음 / {del,ins} 교체(원문→수정·빨강) / {ins,add} 신규추가
import type { ComplianceRule, ComplyEntry } from '@/consult-engine/types';

export const COMPLIANCE: ComplianceRule[] = [
  { law: '금융소비자보호법', desc: '확정·과장 표현 점검' },
  { law: '개인정보법', desc: '불필요 정보 요청 점검' },
  { law: '신용정보법', desc: '활용 범위 준수 점검' },
  { law: '표현리스크', desc: '오해·강요 문구 점검' },
];

export const COMPLY: ComplyEntry[] = [
  {
    draftHtml:
      '바쁘신데 불쑥 연락드려 죄송해요. 마케팅 및 개인정보 활용에 동의해주셔서 대출상품을 안내드리려고 연락드렸는데요. 오늘은 <span class="risk">무조건 더 싸게 갈아타게 해드릴 테니</span> <span class="risk">지금 신청만 하시면 됩니다.</span>',
    flags: [true, false, false, true],
    final: [
      { t: '바쁘신데 불쑥 연락드려 죄송해요. 마케팅 및 개인정보 활용에 동의해주셔서 대출상품을 안내드리려고 연락드렸는데요. 오늘은 ' },
      { del: '무조건 더 싸게 갈아타게', ins: '신청이 아니라 기존 대출 유지가 나은지 비교만' },
      { t: ' 도와드리려는 거예요. ' },
      { del: '지금 신청만 하시면 됩니다.', ins: '잠깐 괜찮으실까요?' },
    ],
  },
  {
    draftHtml:
      '<span class="risk">당연히 갈아타시는 게 무조건 이득이에요.</span> <span class="risk">신용대출 12%, 담보대출 10%로 확정해드립니다.</span>',
    flags: [true, false, false, true],
    final: [
      { del: '당연히 갈아타시는 게 무조건 이득이에요.', ins: '맞습니다. 조건은 실제로 확인하셔야 해요.' },
      { t: ' ' },
      { del: '신용대출 12%, 담보대출 10%로 확정해드립니다.', ins: '신용대출 예상 금리는 12%대, 자동차 담보대출 예상 금리는 10%대 예상됩니다.' },
    ],
  },
  {
    draftHtml: '신용대환하시면 <span class="risk">무조건 12%대로 확정해서 낮춰드립니다.</span>',
    flags: [true, false, false, true],
    final: [
      { t: '신용대환이면 ' },
      { del: '무조건 12%대로 확정해서 낮춰드립니다.', ins: '12%대도 가능하실 수 있어요.' },
      { ins: '다만 확정은 아니고 심사 후 결정됩니다.', add: true },
    ],
  },
  {
    draftHtml:
      '<span class="risk">이 정도면 무조건 큰 이득이에요.</span> 우대까지 받으면 <span class="risk">무조건 10%대로 내려갑니다.</span>',
    flags: [true, false, false, true],
    final: [
      { del: '이 정도면 무조건 큰 이득이에요.', ins: '숫자만 보면 작게 느껴지실 수 있어요.' },
      { t: ' 우대 적용되면 ' },
      { del: '무조건 10%대로 내려갑니다.', ins: '10%대까지 내려갈 가능성도 있습니다.' },
    ],
  },
  {
    draftHtml:
      '대출 중에도 차량은 기존처럼 그대로 운행하실 수 있습니다. 다만, 본 상품은 차량에 저당이 설정되는 담보대출이므로, <span class="risk">담보 설정하면 차는 바로 압류됩니다.</span>',
    flags: [false, false, false, true],
    final: [
      { t: '대출 중에도 차량은 기존처럼 그대로 운행하실 수 있습니다. 다만, 본 상품은 차량에 저당이 설정되는 담보대출이므로, ' },
      { del: '담보 설정하면 차는 바로 압류됩니다.', ins: '상세한 설정 조건과 해지 절차는 심사 후 정확히 안내해 드리겠습니다.' },
    ],
  },
  {
    draftHtml:
      '<span class="risk">담보 안 잡으면 손해세요.</span> <span class="risk">일단 신청부터 하셔야 합니다.</span>',
    flags: [true, false, false, true],
    final: [
      { del: '담보 안 잡으면 손해세요.', ins: '그 마음 당연하세요. 강요 안 드려요.' },
      { t: ' ' },
      { del: '일단 신청부터 하셔야 합니다.', ins: '신청 말고 조건만 비교해보는 것도 가능합니다. 결정은 고객님이 하시면 돼요.' },
    ],
  },
  {
    draftHtml:
      '그럼요. 금리랑 한도 <span class="risk">지금 바로 확정해서 알려드릴게요.</span> <span class="risk">주민번호만 불러주세요.</span>',
    flags: [true, true, false, false],
    final: [
      { t: '네, 가능합니다. 최종 금리·한도는 ' },
      { del: '지금 바로 확정해서 알려드릴게요.', ins: '심사로 정해지고,' },
      { t: ' 진행은 다 들어보신 뒤 ' },
      { del: '주민번호만 불러주세요.', ins: '직접 결정하시면 돼요.' },
    ],
  },
  {
    draftHtml:
      '네, 고객님, 대출은 별도 구비서류 없이 진행하실 수 있어요. 그럼 본 심사 시작하겠습니다. <span class="risk">오늘 안에 무조건 승인 나니까 바로 송금해드릴게요.</span>',
    flags: [true, false, false, true],
    final: [
      { t: '네, 고객님, 대출은 별도 구비서류 없이 진행하실 수 있어요. 그럼 본 심사 시작하겠습니다. ' },
      { del: '오늘 안에 무조건 승인 나니까 바로 송금해드릴게요.', ins: '정확한 본인확인을 위해 몇 가지 확인 후 진행해 드리겠습니다.' },
    ],
  },
];
