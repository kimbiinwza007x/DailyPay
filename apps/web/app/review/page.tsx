import Link from 'next/link';
import type { BatchSummaryDto } from '@dailypay/shared';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Badge, ButtonLink, Card, Empty, ErrorNote } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ReviewQueuePage() {
  let batches: BatchSummaryDto[] = [];
  let error: string | null = null;
  try {
    batches = await apiFetch<BatchSummaryDto[]>('/batches');
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">คิวรอตรวจ</h1>
        <ButtonLink href="/upload">นำเข้าไฟล์</ButtonLink>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <Card>
        {batches.length === 0 ? (
          <Empty>ยังไม่มีไฟล์ที่นำเข้า</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">ไฟล์</th>
                  <th className="py-2 pr-3 font-medium">นำเข้าเมื่อ</th>
                  <th className="py-2 pr-3 text-right font-medium">ทั้งหมด</th>
                  <th className="py-2 pr-3 text-right font-medium">นำเข้าได้</th>
                  <th className="py-2 pr-3 text-right font-medium">ซ้ำ</th>
                  <th className="py-2 pr-3 text-right font-medium">รอตรวจ</th>
                  <th className="py-2 font-medium">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className="max-w-[16rem] truncate py-2.5 pr-3">
                      <Link href={`/review/${b.id}`} className="font-medium hover:text-brand">
                        {b.fileName ?? 'ไม่มีชื่อไฟล์'}
                      </Link>
                      {b.errorMessage && (
                        <p className="truncate text-xs text-expense">{b.errorMessage}</p>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-muted">{formatDate(b.createdAt)}</td>
                    <td className="tabular py-2.5 pr-3 text-right">{b.rowCount}</td>
                    <td className="tabular py-2.5 pr-3 text-right text-income">
                      {b.importedCount}
                    </td>
                    <td className="tabular py-2.5 pr-3 text-right text-muted">
                      {b.duplicateCount}
                    </td>
                    <td className="tabular py-2.5 pr-3 text-right text-warn">{b.reviewCount}</td>
                    <td className="py-2.5">
                      <Badge kind={b.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
