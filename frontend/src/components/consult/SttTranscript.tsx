// SttTranscript — 좌측 STT 대화창 본문 (SSOT docs/consult_redesigned-3.html .stt__body 내부).
//
// 여정 8단계(JOURNEY)의 mini-chat 컨테이너(#sch0~7)를 선언적으로 렌더한다.
// 말풍선 추가·단어별 reveal·타이핑·fly-bubble은 타이밍이 핵심이라 SSOT와 정확히
// 일치시키기 위해 엔진(useConsultEngine)이 이 컨테이너들에 ref/DOM으로 주입한다.
// (계획: imperative 부분은 ref로 격리.)
'use client';

import { JOURNEY } from '@/consult-engine/data/scenario';

export function SttTranscript() {
  return (
    <>
      <div className="jov-title">STT 화면</div>
      <div id="steps-wrap" data-testid="stt-steps">
        {JOURNEY.map((step, i) => (
          <div className="step-item" key={i} data-step={i}>
            <div className="step-right">
              {/* 엔진이 발화 말풍선을 이 컨테이너에 누적 (SSOT chatHolder #sch{N}) */}
              <div className="mini-chats" id={`sch${i}`} data-step-label={step.label} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
