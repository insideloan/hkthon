// DbCard — 카드② DB 분석 (SSOT docs/consult_redesigned-3.html #card-db).
// 엔진(useConsultEngine)이 card2Store에 단계적으로 기록 → 선언적 렌더.
//   사용데이터 칩(usebox) → flash → bridge(▼) → 분석결과 도식(diag nodes + banner)
'use client';

import { clsx } from 'clsx';
import { useCard2Store } from '@/stores/card2Store';

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

// 라이브 변형 — DB분석은 wire 구독 소스가 없으므로(card2Store는 mock 엔진 전용),
// 라이브 세션에서는 대화 진행에 맞춘 분석 진행 표시를 렌더한다.
function LiveDbCard() {
  const USED_DATA = ['고객 프로필', '보유 대출', '신용평가', '대환 한도'];
  return (
    <div className="card-scroll" data-testid="db-card-live">
      <div className="cseclbl"><span>사용 데이터</span><span className="ln" /></div>
      <div className="usebox" data-testid="db-use">
        {USED_DATA.map((nm, i) => (
          <div key={i} className="usecard on">
            <DbIcon />
            <b>{nm}</b>
          </div>
        ))}
      </div>
      <div className="usedivider on"><span className="dn">▼</span></div>
      <div className="cseclbl"><span>데이터 분석 결과</span><span className="ln" /></div>
      <div className="resbox" data-testid="db-res">
        <p className="text-[12px] leading-[1.6] text-ink-dim px-1 py-2">
          통화 내용을 기반으로 고객 프로필·보유 대출·신용 조건을 실시간 조회하고 있습니다.
          대환 가능 한도와 금리 비교 결과가 준비되는 대로 표시됩니다.
        </p>
      </div>
    </div>
  );
}

export function DbCard({ live = false }: { live?: boolean } = {}) {
  // 라이브 세션: wire 소스가 없는 카드이므로 진행 표시 변형을 렌더.
  // (hooks 규칙: 분기 전에 store를 호출하지 않도록 별도 컴포넌트로 분리)
  if (live) return <LiveDbCard />;
  return <EngineDbCard />;
}

function EngineDbCard() {
  const { use, flash, bridge, diag, shownNodes, bannerOn } = useCard2Store();

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

      {/* 사용데이터 → 분석결과 전이 화살표 */}
      <div className={clsx('usedivider', bridge && 'on')} id="dbBridge">
        <span className="dn">▼</span>
      </div>

      <div className="cseclbl">
        <span>데이터 분석 결과</span>
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
