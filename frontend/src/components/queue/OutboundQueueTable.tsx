// OutboundQueueTable — admin dashboard call list (FRONTEND-001 / #30).
// Initial load: `queue` query; realtime: `onQueueUpdate` subscription (lib/appsync.ts).
// Consumes the queue store; styling only via ui/* wrappers (CONVENTIONS.md §6.1).
'use client';

import { useEffect } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { RiskBar } from '@/components/ui/RiskBar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import { fetchQueue, subscribeQueueUpdates } from '@/lib/appsync';
import { useQueueStore } from '@/stores/queueStore';
import type { CallState, QueueRow } from '@/types/queue';

// Call state → human label (Korean) + badge tone. reference/API.md state machine.
const STATE_LABEL: Record<CallState, string> = {
  DIALING: '발신중',
  RINGING: '연결중',
  ACCEPTED: '수락',
  REJECTED: '거절',
  IN_CALL: '통화중',
  TRANSFER_PENDING: '상담원 연결 대기',
  AGENT_JOINED: '상담원 연결됨',
  ENDED: '종료',
};

const STATE_TONE: Record<CallState, BadgeTone> = {
  DIALING: 'noanswer',
  RINGING: 'noanswer',
  ACCEPTED: 'active',
  REJECTED: 'rejected',
  IN_CALL: 'active',
  TRANSFER_PENDING: 'escalate',
  AGENT_JOINED: 'signup',
  ENDED: 'neutral',
};

/** Map a row's highlight flag to row emphasis. */
function rowEmphasis(highlight: QueueRow['highlight']): 'none' | 'warn' | 'danger' {
  if (highlight === 'needs_agent') return 'danger';
  if (highlight === 'fraud_suspected') return 'warn';
  return 'none';
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type OutboundQueueTableProps = {
  /** When true, skip data wiring (load + subscribe). Tests seed the store directly. */
  disableLiveData?: boolean;
};

export function OutboundQueueTable({ disableLiveData = false }: OutboundQueueTableProps) {
  const rows = useQueueStore((s) => s.rows);
  const setQueue = useQueueStore((s) => s.setQueue);

  useEffect(() => {
    if (disableLiveData) return;
    let active = true;
    fetchQueue()
      .then((result) => {
        if (active) setQueue(result);
      })
      .catch((err) => console.error('queue 초기 로드 실패', err));
    const unsubscribe = subscribeQueueUpdates(
      (result) => setQueue(result),
      (err) => console.error('onQueueUpdate 구독 오류', err),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [disableLiveData, setQueue]);

  return (
    <Table aria-label="아웃바운드 콜 큐">
      <TableHead>
        <tr>
          <TableHeaderCell>고객</TableHeaderCell>
          <TableHeaderCell>상태</TableHeaderCell>
          <TableHeaderCell>단계</TableHeaderCell>
          <TableHeaderCell>이탈위험</TableHeaderCell>
          <TableHeaderCell>담당</TableHeaderCell>
          <TableHeaderCell>시간</TableHeaderCell>
          <TableHeaderCell>채널</TableHeaderCell>
        </tr>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.callId}
            emphasis={rowEmphasis(row.highlight)}
            data-testid={`queue-row-${row.callId}`}
            data-highlight={row.highlight ?? 'none'}
          >
            <TableCell>{row.customerName}</TableCell>
            <TableCell>
              <Badge tone={STATE_TONE[row.state]}>{STATE_LABEL[row.state]}</Badge>
            </TableCell>
            <TableCell>{row.targetProduct}</TableCell>
            <TableCell>
              {typeof row.churnRisk === 'number' ? (
                <RiskBar value={row.churnRisk} />
              ) : (
                <span className="text-xs text-gray-400">—</span>
              )}
            </TableCell>
            <TableCell>{row.highlight === 'needs_agent' ? '상담원' : 'AI'}</TableCell>
            <TableCell className="tabular-nums">{formatElapsed(row.elapsedSec)}</TableCell>
            <TableCell>{row.scenario}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
