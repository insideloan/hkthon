// 모바일 상담 화면 (/m/call/[id]) — 라이브 통화만 풀스크린으로. 관리자 코파일럿
// 화면(여정맵·고객DB·컴플라이언스 카드)은 전부 제외하고 LiveSession만 띄운다.
// 진입은 /m 폼 제출로만 이뤄지며, 종료 시 CRM 대신 체험 완료 안내로 보낸다.
'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LiveSession } from '@/components/consult/LiveSession';
import { useBotAudioPlayback } from '@/hooks/useBotAudioPlayback';
import { useExperienceStore } from '@/stores/experienceStore';

const IS_MOCK =
  process.env.NEXT_PUBLIC_USE_MOCK === '1' ||
  process.env.NEXT_PUBLIC_USE_MOCK === 'true';

type PageProps = { params: Promise<{ id: string }> };

export default function MobileCallPage({ params }: PageProps) {
  const { id: callId } = use(params);
  const router = useRouter();
  const customer = useExperienceStore((s) => s.customers[callId]);
  const [finished, setFinished] = useState(false);

  // 봇 TTS(mp3) 재생 — 관리자 코파일럿은 이 훅으로 봇 음성을 재생하지만 모바일
  // 화면은 LiveSession만 렌더해 누락돼 있었다(자막만 나오고 소리 없음). 모바일
  // 라이브 경로는 항상 live이므로 활성화한다. 훅 내부에서 모바일 자동재생 정책을
  // 고려해 첫 사용자 제스처에 오디오를 unlock한다.
  useBotAudioPlayback(callId);

  // 폼을 거치지 않고 직접 URL로 들어와 고객 정보가 없으면 입력 폼으로 되돌린다.
  // (mock 데모는 인사말 이름 기본값이 있어 그대로 진행 가능하나, 라이브 백엔드는
  //  experienceStore에 행이 있어야 정상 — 안전하게 폼으로 유도.)
  if (!customer && !IS_MOCK) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="font-disp text-[16px] font-extrabold text-ink">상담 정보를 찾을 수 없습니다.</p>
        <p className="text-[13px] text-ink-dim">처음부터 다시 시작해 주세요.</p>
        <button
          type="button"
          onClick={() => router.replace('/m')}
          className="cursor-pointer rounded-[12px] px-6 py-3 font-disp text-[15px] font-bold text-white"
          style={{ background: 'var(--route)', boxShadow: '0 6px 16px -4px rgba(44,91,214,.55)' }}
        >
          상담 다시 시작
        </button>
      </main>
    );
  }

  // 종료 완료 화면 — CRM 대신 간단한 안내 + 다시 체험 버튼.
  if (finished) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center" data-testid="mobile-call-done">
        <div
          className="grid h-[88px] w-[88px] place-items-center rounded-full"
          style={{ background: 'var(--go)', color: '#fff', boxShadow: '0 10px 28px -8px rgba(46,158,110,.55)' }}
          aria-hidden
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ width: 40, height: 40 }}>
            <path d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <p className="font-disp text-[19px] font-extrabold text-ink">상담이 종료되었습니다.</p>
          <p className="mt-1 text-[13px] text-ink-dim">AI 대출 상담을 체험해 주셔서 감사합니다.</p>
        </div>
        <button
          type="button"
          onClick={() => router.replace('/m')}
          className="cursor-pointer rounded-[12px] px-6 py-3 font-disp text-[15px] font-bold text-white"
          style={{ background: 'var(--route)', boxShadow: '0 6px 16px -4px rgba(44,91,214,.55)' }}
        >
          다시 체험하기
        </button>
      </main>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="mobile-call">
      {/* 상단 통화 헤더 — 관리자 코파일럿의 act-bg를 모바일용으로 단순화 */}
      <header
        className="flex items-center justify-between"
        style={{ padding: '12px 16px', background: 'rgba(231,236,252,.65)', borderBottom: '1px solid var(--hair)' }}
      >
        <span className="inline-flex items-center" style={{ gap: 9 }}>
          <span className="inline-grid place-items-center text-base" style={{ width: 30, height: 30, borderRadius: 9, background: '#fff', boxShadow: '0 4px 12px -5px rgba(53,81,214,.6)' }}>🤖</span>
          <span className="font-disp" style={{ fontSize: 14, fontWeight: 800, color: 'var(--route)' }}>
            {customer?.name ? `${customer.name} 고객님 상담` : '실시간 AI 상담'}
          </span>
        </span>
        <span className="font-mono inline-flex items-center" style={{ gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'var(--danger)' }}>
          <span className="rounded-full" style={{ width: 8, height: 8, background: 'var(--danger)', animation: 'beatG 1.4s ease-out infinite' }} />
          LIVE
        </span>
      </header>

      {/* 라이브 통화 패널 — 종료 시 완료 화면으로 전환(CRM 미사용) */}
      <div className="flex flex-1 min-h-0 flex-col overflow-y-auto">
        <LiveSession
          callId={callId}
          onEnded={() => setFinished(true)}
          customerName={customer?.name}
          // Silero 발화 확률 임계값(0.1~0.9). 모바일은 스피커-마이크 근접·생활소음
          // 환경이라 데스크톱 기본(0.5)보다 민감하게(낮게) 0.4로 시작한다 — 작은/애매한
          // 발화도 잡되, Silero가 비음성 잡음은 모델 단에서 걸러 오탐은 RMS보다 적다.
          initialVadThreshold={0.4}
        />
      </div>
    </div>
  );
}
