// ExperienceModal — 관리자 화면 "체험" 버튼으로 뜨는 고객 정보 입력 팝업.
// 상담 CRM 고객 프로필 필드를 입력받아 체험 고객을 생성한다. 확인 시 onConfirm으로
// 폼 값을 넘기면 부모(page.tsx)가 db 저장 + 큐 최상단 발신중 노출을 처리한다.
'use client';

import { useEffect, useId, useState } from 'react';
import {
  GENDERS, LOAN_TYPES, ASSET_TYPES,
  type ExperienceForm, type Gender, type LoanType, type AssetType,
} from '@/lib/experience';

type ExperienceModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (form: ExperienceForm) => void;
};

const FIELD_STYLE: React.CSSProperties = {
  border: '1px solid var(--card-bd)',
  borderRadius: 9,
  padding: '8px 11px',
  background: 'rgba(255,255,255,.7)',
  fontSize: 13,
  color: 'var(--ink)',
  width: '100%',
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--ink-faint)',
  marginBottom: 4,
  display: 'block',
};

export function ExperienceModal({ open, onClose, onConfirm }: ExperienceModalProps) {
  const titleId = useId();
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender>('남');
  const [age, setAge] = useState('40');
  const [loanType, setLoanType] = useState<LoanType>('주택담보대출');
  const [loanAmount, setLoanAmount] = useState('24000');
  const [assetType, setAssetType] = useState<AssetType>('아파트');
  const [assetAmount, setAssetAmount] = useState('52000');
  const [error, setError] = useState<string | null>(null);

  // 열릴 때마다 폼 초기화(이전 입력 잔존 방지).
  useEffect(() => {
    if (!open) return;
    setName('');
    setGender('남');
    setAge('40');
    setLoanType('주택담보대출');
    setLoanAmount('24000');
    setAssetType('아파트');
    setAssetAmount('52000');
    setError(null);
  }, [open]);

  // ESC 로 닫기.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const loanDisabled = loanType === '없음';
  const assetDisabled = assetType === '없음';

  const handleConfirm = () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('이름을 입력해 주세요.'); return; }
    const ageNum = parseInt(age, 10);
    if (!Number.isFinite(ageNum) || ageNum <= 0) { setError('나이를 올바르게 입력해 주세요.'); return; }
    onConfirm({
      name: trimmed,
      gender,
      age: ageNum,
      loanType,
      loanAmount: loanDisabled ? 0 : Math.max(0, parseInt(loanAmount, 10) || 0),
      assetType,
      assetAmount: assetDisabled ? 0 : Math.max(0, parseInt(assetAmount, 10) || 0),
    });
  };

  return (
    // 오버레이 — 클릭 시 닫기(버블 차단은 패널에서).
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(20,22,30,.42)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
      data-testid="experience-modal-overlay"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="experience-modal"
        className="glass-card"
        style={{
          width: 'min(460px, calc(100vw - 32px))',
          borderRadius: 18,
          padding: '20px 22px',
          background: 'var(--card, #F9F6EE)',
          boxShadow: 'var(--shadow)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id={titleId}
          className="font-disp"
          style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', margin: '0 0 4px' }}
        >
          체험 고객 정보 입력
        </h2>
        <p style={{ fontSize: 12, color: 'var(--ink-faint)', margin: '0 0 16px' }}>
          신용점수·현 금리·이탈위험은 자동 배정됩니다.
        </p>

        <div className="flex flex-col gap-[12px]">
          {/* 이름 */}
          <div>
            <label style={LABEL_STYLE} htmlFor={`${titleId}-name`}>이름</label>
            <input
              id={`${titleId}-name`}
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
              <label style={LABEL_STYLE} htmlFor={`${titleId}-gender`}>성별</label>
              <select
                id={`${titleId}-gender`}
                data-testid="exp-gender"
                value={gender}
                onChange={(e) => setGender(e.target.value as Gender)}
                style={FIELD_STYLE}
              >
                {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label style={LABEL_STYLE} htmlFor={`${titleId}-age`}>나이</label>
              <input
                id={`${titleId}-age`}
                data-testid="exp-age"
                type="number"
                min={1}
                value={age}
                onChange={(e) => setAge(e.target.value)}
                style={FIELD_STYLE}
              />
            </div>
          </div>

          {/* 보유대출 종류 · 금액 */}
          <div className="grid grid-cols-2 gap-[12px]">
            <div>
              <label style={LABEL_STYLE} htmlFor={`${titleId}-loan`}>보유 대출</label>
              <select
                id={`${titleId}-loan`}
                data-testid="exp-loan-type"
                value={loanType}
                onChange={(e) => setLoanType(e.target.value as LoanType)}
                style={FIELD_STYLE}
              >
                {LOAN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={LABEL_STYLE} htmlFor={`${titleId}-loan-amt`}>대출 금액(만원)</label>
              <input
                id={`${titleId}-loan-amt`}
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
              <label style={LABEL_STYLE} htmlFor={`${titleId}-asset`}>자산</label>
              <select
                id={`${titleId}-asset`}
                data-testid="exp-asset-type"
                value={assetType}
                onChange={(e) => setAssetType(e.target.value as AssetType)}
                style={FIELD_STYLE}
              >
                {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={LABEL_STYLE} htmlFor={`${titleId}-asset-amt`}>자산 금액(만원)</label>
              <input
                id={`${titleId}-asset-amt`}
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
            <p data-testid="exp-error" style={{ fontSize: 12, color: 'var(--danger)', margin: 0 }}>
              {error}
            </p>
          )}
        </div>

        {/* 액션 */}
        <div className="flex justify-end gap-[8px]" style={{ marginTop: 20 }}>
          <button
            type="button"
            data-testid="exp-cancel"
            onClick={onClose}
            className="cursor-pointer"
            style={{
              fontSize: 13, fontWeight: 700, color: 'var(--ink-dim)',
              background: 'rgba(255,255,255,.6)', border: '1px solid var(--card-bd)',
              borderRadius: 9, padding: '9px 16px',
            }}
          >
            취소
          </button>
          <button
            type="button"
            data-testid="exp-confirm"
            onClick={handleConfirm}
            className="cursor-pointer"
            style={{
              fontSize: 13, fontWeight: 700, color: '#fff',
              background: 'var(--route)', border: 'none', borderRadius: 9,
              padding: '9px 18px', boxShadow: '0 4px 12px -3px rgba(44,91,214,.5)',
            }}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
