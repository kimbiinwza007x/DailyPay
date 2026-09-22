import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { AccountDto, BatchDetailDto, CategoryDto } from '@dailypay/shared';
import { apiFetch, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Badge, Card, ErrorNote } from '@/components/ui';
import ReviewTable from './review-table';

export const dynamic = 'force-dynamic';

export default async function ReviewBatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;

  let detail: BatchDetailDto;
  let accounts: AccountDto[] = [];
  let categories: CategoryDto[] = [];
  try {
    [detail, accounts, categories] = await Promise.all([
      apiFetch<BatchDetailDto>(`/batches/${batchId}`),
      apiFetch<AccountDto[]>('/accounts'),
      apiFetch<CategoryDto[]>('/categories'),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    return (
      <ErrorNote>{e instanceof Error ? e.message : String(e)}</ErrorNote>
    );
  }

  const { batch, rows } = detail;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/review" className="text-sm text-muted hover:text-ink">
          ← กลับไปคิวรอตรวจ
        </Link>
        <h1 className="font-display mt-1 text-xl font-semibold">
          {batch.fileName ?? 'ไม่มีชื่อไฟล์'}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <Badge kind={batch.status} />
          <span>{formatDate(batch.createdAt)}</span>
          <span>
            ทั้งหมด {batch.rowCount} · นำเข้าได้ {batch.importedCount} · ซ้ำ{' '}
            {batch.duplicateCount} · รอตรวจ {batch.reviewCount}
          </span>
        </p>
      </div>

      {batch.status === 'parsing' && (
        <div className="rounded-xl bg-info/10 px-4 py-3 text-sm text-info">
          กำลังแยกข้อมูลอยู่ — worker ยังทำงานไม่เสร็จ รีเฟรชอีกครั้งในอีกสักครู่
          (ถ้าค้างนาน ตรวจว่ารัน <code>pnpm dev:worker</code> อยู่หรือเปล่า)
        </div>
      )}
      {batch.errorMessage && <ErrorNote>{batch.errorMessage}</ErrorNote>}

      <Card>
        {batch.status === 'review' ? (
          <ReviewTable
            batchId={batch.id}
            rows={rows}
            accounts={accounts}
            categories={categories}
            defaultAccountId={null}
          />
        ) : (
          <p className="text-sm text-muted">
            batch นี้อยู่สถานะ &ldquo;{batch.status}&rdquo; จึงแก้ไข/ยืนยันไม่ได้แล้ว
          </p>
        )}
      </Card>
    </div>
  );
}
