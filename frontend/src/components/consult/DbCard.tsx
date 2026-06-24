// DbCard — 카드② DB 분석 (SSOT docs/consult_redesigned-3.html #card-db).
// 엔진(useConsultEngine)이 card2Store에 단계적으로 기록 → 선언적 렌더.
//   사용데이터 칩(usebox) → flash → bridge(▼) → 분석결과 도식(diag nodes + banner)
'use client';

import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { useCard2Store } from '@/stores/card2Store';
import * as appsyncMod from '@/lib/appsync';
import type { DbNode } from '@/types/realtime';

// DB 아이콘 (SSOT DBIC, 라인 1903) — usecard 앞 실린더 아이콘.
function DbIcon() {
  return (
    <svg className="di" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <ellipse cx={8} cy={4} rx={5} ry={2} stroke="currentColor" strokeWidth={1.4} />
      <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" stroke="currentColor" strokeWidth={1.4} />
      <path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" stroke="currentColor" strokeWidth={1.4} opacity={0.55} />
    </svg>
  );
}

// 분석결과 노드 tone → 색.
const TONE_CLASS: Record<string, string> = {
  pos: 'text-go',
  warn: 'text-route',
  neg: 'text-danger',
};

// 라이브 변형 — 체험 시나리오에서는 onIndexUpdate(dbChips/dbNodes) preset을 구독해
// 사용 데이터 칩 + 분석결과 노드를 렌더. preset 도착 전(또는 미설정)에는 진행 표시.
function LiveDbCard({ callId }: { callId?: string }) {
  const [chips, setChips] = useState<string[]>([]);
  const [nodes, setNodes] = useState<DbNode[]>([]);

  useEffect(() => {
    if (!callId) return;
    if (!('subscribeIndexUpdate' in appsyncMod)) return;
    const sub = appsyncMod.subscribeIndexUpdate;
    if (typeof sub !== 'function') return;
    const unsub = sub(
      callId,
      (index) => {
        if (index.dbChips && index.dbChips.length) setChips(index.dbChips);
        if (index.dbNodes && index.dbNodes.length) setNodes(index.dbNodes);
      },
      (err) => console.error('onIndexUpdate(DbCard) 구독 오류', err),
    );
    return unsub;
  }, [callId]);

  const hasPreset = chips.length > 0 || nodes.length > 0;
  const usedData = chips.length ? chips : ['고객 프로필', '보유 대출', '신용평가', '대환 한도'];

  return (
    <div className="card-scroll" data-testid="db-card-live">
      <div className="cseclbl"><span>사용 데이터</span><span className="ln" /></div>
      <div className="usebox" data-testid="db-use">
        {usedData.map((nm, i) => (
          <div key={i} className="usecard on">
            <DbIcon />
            <b>{nm}</b>
          </div>
        ))}
      </div>
      {/* usedivider(▼) 제거됨 */}
      <div className="cseclbl cseclbl--sec"><span>분석 결과</span><span className="ln" /></div>
      <div className="resbox" data-testid="db-res">
        {hasPreset && nodes.length ? (
          <div className="flex flex-col gap-1.5 px-1 py-2">
            {nodes.map((n, i) => (
              <div key={i} className="flex items-center justify-between text-[12px]" data-testid="db-node">
                <span className="text-ink-dim">{n.label}</span>
                <b className={clsx('font-disp', n.tone ? TONE_CLASS[n.tone] : 'text-ink')}>{n.val ?? ''}</b>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12px] leading-[1.6] text-ink-dim px-1 py-2">
            통화 내용을 기반으로 고객 프로필·보유 대출·신용 조건을 실시간 조회하고 있습니다.
            대환 가능 한도와 금리 비교 결과가 준비되는 대로 표시됩니다.
          </p>
        )}
      </div>
    </div>
  );
}

export function DbCard({ live = false, callId }: { live?: boolean; callId?: string } = {}) {
  // 라이브 세션: 체험 preset(onIndexUpdate dbChips/dbNodes)을 구독해 렌더.
  // (hooks 규칙: 분기 전에 store를 호출하지 않도록 별도 컴포넌트로 분리)
  if (live) return <LiveDbCard callId={callId} />;
  return <EngineDbCard />;
}

function EngineDbCard() {
  const { use, flash, diag, shownNodes, bannerOn } = useCard2Store();

  return (
    <div className="card-scroll">
      <div className="cseclbl">
        <span>사용 데이터</span>
        <span className="ln" />
      </div>

      {/* 사용데이터 칩 */}
      <div className="usebox" id="dbUse" data-testid="db-use">
        {use.map((nm, i) => (
          <div key={i} className={clsx('usecard', 'on', flash && 'flash')}>
            <DbIcon />
            <b>{nm}</b>
          </div>
        ))}
      </div>

      {/* 사용데이터 → 분석결과 전이 화살표(▼) 제거됨 */}

      <div className="cseclbl cseclbl--sec">
        <span>분석 결과</span>
        <span className="ln" />
      </div>

      {/* 분석결과 도식: 원형 노드 + 요약 배너 */}
      <div className="resbox" id="dbRes" data-testid="db-res">
        {diag && (
          <div className="diag">
            <div className="diag-row">
              {diag.nodes.map((n, i) => (
                <div key={i} className={clsx('dnode', n.tone, i < shownNodes && 'on')}>
                  <div className="dcirc">
                    <span className="dic">{n.label}</span>
                    <span className="dval">{n.val}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className={clsx('dbanner', diag.banner.tone, bannerOn && 'on')}>
              <span className="dbic">{diag.banner.tone === 'ok' ? '✓' : '!'}</span>
              <span>{diag.banner.text}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
