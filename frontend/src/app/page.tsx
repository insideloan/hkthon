// 관리자 대시보드 (/) — 콜 큐 + 요약 카드. FRONTEND-001 (#30).
// 초기 로드 `queue` 쿼리 + 실시간 `onQueueUpdate` 구독은 OutboundQueueTable이 수행.
import { OutboundQueueTable } from '@/components/queue/OutboundQueueTable';

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-xl font-semibold">관리자 콜 큐</h1>
      <OutboundQueueTable />
    </main>
  );
}
