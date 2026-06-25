// 모바일 체험 진입 폼 (/m) — QR로 접속하면 이 화면이 바로 뜬다. 관리자 화면
// "체험" 모달(ExperienceModal)과 동일한 고객 정보를 입력받지만, 모달이 아니라
// 풀스크린 폼이고 확인 시 큐를 거치지 않고 곧장 라이브 상담(/m/call/{callId})으로
// 이동한다. 폼/검증/고객 생성 로직은 lib/experience.ts를 그대로 재사용한다.
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  GENDERS, LOAN_TYPES, ASSET_TYPES,
  buildExperienceCustomer,
  type Gender, type LoanType, type AssetType,
} from '@/lib/experience';
import { useExperienceStore } from '@/stores/experienceStore';
import { VadPreloader } from '@/components/VadPreloader';

const FIELD_STYLE: React.CSSProperties = {
  border: '1px solid var(--card-bd)',
  borderRadius: 11,
  padding: '13px 14px',
  background: 'rgba(255,255,255,.85)',
  fontSize: 16, // 16px+ → iOS Safari가 입력 시 자동 확대하지 않음
  color: 'var(--ink)',
  width: '100%',
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--ink-faint)',
  marginBottom: 6,
  display: 'block',
};

export default function MobileExperiencePage() {
  const router = useRouter();
  const addCustomer = useExperienceStore((s) => s.addCustomer);

  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender>('남');
  const [age, setAge] = useState('40');
  const [loanType, setLoanType] = useState<LoanType>('주택담보대출');
  const [loanAmount, setLoanAmount] = useState('24000');
  const [assetType, setAssetType] = useState<AssetType>('아파트');
  const [assetAmount, setAssetAmount] = useState('52000');
  const [error, setError] = useState<string | null>(null);

  const loanDisabled = loanType === '없음';
  const assetDisabled = assetType === '없음';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError('이름을 입력해 주세요.'); return; }
    const ageNum = parseInt(age, 10);
    if (!Number.isFinite(ageNum) || ageNum <= 0) { setError('나이를 올바르게 입력해 주세요.'); return; }

    // 큐(관리자 전용)를 거치지 않고 체험 고객만 생성 → 스토어 저장 후 상담 화면으로.
    const seed = Date.now();
    const customer = buildExperienceCustomer(
      {
        name: trimmed,
        gender,
        age: ageNum,
        loanType,
        loanAmount: loanDisabled ? 0 : Math.max(0, parseInt(loanAmount, 10) || 0),
        assetType,
        assetAmount: assetDisabled ? 0 : Math.max(0, parseInt(assetAmount, 10) || 0),
      },
      seed,
    );
    addCustomer(customer);
    router.push(`/m/call/${customer.callId}`);
  };

  return (
    <main className="flex flex-1 flex-col px-5 pb-8 pt-7">
      {/* 랜딩 idle 시점에 라이브 상담용 VAD/DNF 에셋(~35MB)을 미리 받아둔다(통화 시작 즉시화). */}
      <VadPreloader />
      {/* 헤더 */}
      <header className="mb-6">
        <h1 className="font-disp" style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', margin: 0 }}>
          AI 대출 상담 체험
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink-faint)', margin: '6px 0 0' }}>
          정보를 입력하고 <b>상담 시작</b>을 누르면 AI 상담원과 바로 통화가 시작됩니다.
        </p>
        <p style={{ fontSize: 12, color: 'var(--ink-faint)', margin: '4px 0 0' }}>
          신용점수·현 금리·이탈위험은 자동 배정됩니다.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-[14px]" data-testid="mobile-exp-form">
        {/* 이름 */}
        <div>
          <label style={LABEL_STYLE} htmlFor="m-name">이름</label>
          <input
            id="m-name"
            data-testid="exp-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 박서준"
            style={FIELD_STYLE}
            autoFocus
          />
        </div>

        {/* 성별 · 나이 */}
        <div className="grid grid-cols-2 gap-[12px]">
          <div>
            <label style={LABEL_STYLE} htmlFor="m-gender">성별</label>
            <select id="m-gender" data-testid="exp-gender" value={gender} onChange={(e) => setGender(e.target.value as Gender)} style={FIELD_STYLE}>
              {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label style={LABEL_STYLE} htmlFor="m-age">나이</label>
            <input id="m-age" data-testid="exp-age" type="number" min={1} value={age} onChange={(e) => setAge(e.target.value)} style={FIELD_STYLE} />
          </div>
        </div>

        {/* 보유대출 종류 · 금액 */}
        <div className="grid grid-cols-2 gap-[12px]">
          <div>
            <label style={LABEL_STYLE} htmlFor="m-loan">보유 대출</label>
            <select id="m-loan" data-testid="exp-loan-type" value={loanType} onChange={(e) => setLoanType(e.target.value as LoanType)} style={FIELD_STYLE}>
              {LOAN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={LABEL_STYLE} htmlFor="m-loan-amt">대출 금액(만원)</label>
            <input
              id="m-loan-amt"
              data-testid="exp-loan-amount"
              type="number"
              min={0}
              value={loanDisabled ? '' : loanAmount}
              onChange={(e) => setLoanAmount(e.target.value)}
              disabled={loanDisabled}
              placeholder={loanDisabled ? '—' : '예: 24000'}
              style={{ ...FIELD_STYLE, opacity: loanDisabled ? 0.5 : 1 }}
            />
          </div>
        </div>

        {/* 자산 종류 · 금액 */}
        <div className="grid grid-cols-2 gap-[12px]">
          <div>
            <label style={LABEL_STYLE} htmlFor="m-asset">자산</label>
            <select id="m-asset" data-testid="exp-asset-type" value={assetType} onChange={(e) => setAssetType(e.target.value as AssetType)} style={FIELD_STYLE}>
              {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={LABEL_STYLE} htmlFor="m-asset-amt">자산 금액(만원)</label>
            <input
              id="m-asset-amt"
              data-testid="exp-asset-amount"
              type="number"
              min={0}
              value={assetDisabled ? '' : assetAmount}
              onChange={(e) => setAssetAmount(e.target.value)}
              disabled={assetDisabled}
              placeholder={assetDisabled ? '—' : '예: 52000'}
              style={{ ...FIELD_STYLE, opacity: assetDisabled ? 0.5 : 1 }}
            />
          </div>
        </div>

        {error && (
          <p data-testid="exp-error" style={{ fontSize: 13, color: 'var(--danger)', margin: 0 }}>
            {error}
          </p>
        )}

        {/* 하단 고정 CTA — 큰 터치 타깃 */}
        <button
          type="submit"
          data-testid="mobile-exp-submit"
          className="mt-auto cursor-pointer"
          style={{
            fontSize: 16, fontWeight: 800, color: '#fff',
            background: 'var(--route)', border: 'none', borderRadius: 13,
            padding: '16px 18px', boxShadow: '0 6px 16px -4px rgba(44,91,214,.55)',
          }}
        >
          상담 시작
        </button>
      </form>
    </main>
  );
}
