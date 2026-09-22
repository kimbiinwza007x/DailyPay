import type { AccountBalanceDto, BatchSummaryDto, MonthlyReportDto } from '@dailypay/shared';
import { apiFetch } from '@/lib/api';
import { currentMonth, formatDate, formatMonth, formatMoney } from '@/lib/format';
import { Badge, ButtonLink, Card, Empty, ErrorNote, Stat } from '@/components/ui';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  let report: MonthlyReportDto | null = null;
  let summary: { needsReview: number; balances: AccountBalanceDto[] } | null = null;
  let batches: BatchSummaryDto[] = [];
  let error: string | null = null;

  try {
    [report, summary, batches] = await Promise.all([
      apiFetch<MonthlyReportDto>(`/reports/monthly?month=${currentMonth()}`),
      apiFetch<{ needsReview: number; balances: AccountBalanceDto[] }>('/reports/summary'),
      apiFetch<BatchSummaryDto[]>('/batches?status=review'),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-xl font-semibold">ภาพรวม</h1>
        <ErrorNote>
          เชื่อมต่อ API ไม่ได้ — {error}
          <br />
          ตรวจว่ารัน <code>pnpm dev:api</code> อยู่ และตั้ง NEXT_PUBLIC_API_URL ถูกต้อง
        </ErrorNote>
      </div>
    );
  }

  const offBalance = (summary?.balances ?? []).filter(
    (b) => b.diff !== null && Number(b.diff) !== 0,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">
          ภาพรวม · {formatMonth(currentMonth())}
        </h1>
        <ButtonLink href="/upload">นำเข้าไฟล์</ButtonLink>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="รายรับเดือนนี้" value={formatMoney(report!.income)} tone="income" />
        <Stat label="รายจ่ายเดือนนี้" value={formatMoney(report!.expense)} tone="expense" />
        <Stat
          label="คงเหลือสุทธิ"
          value={formatMoney(report!.net)}
          tone={Number(report!.net) < 0 ? 'expense' : 'ink'}
        />
        <Stat
          label="รายการรอตรวจ"
          value={`${summary?.needsReview ?? 0} รายการ`}
          tone={summary && summary.needsReview > 0 ? 'warn' : 'ink'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="ไฟล์ที่รอยืนยัน"
          action={
            <Link href="/review" className="text-sm text-brand hover:underline">
              ดูทั้งหมด
            </Link>
          }
        >
          {batches.length === 0 ? (
            <Empty>ไม่มีไฟล์ค้างในคิว</Empty>
          ) : (
            <ul className="divide-y divide-black/5">
              {batches.slice(0, 5).map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link
                      href={`/review/${b.id}`}
                      className="block truncate text-sm font-medium hover:text-brand"
                    >
                      {b.fileName ?? 'ไม่มีชื่อไฟล์'}
                    </Link>
                    <p className="text-xs text-muted">
                      {formatDate(b.createdAt)} · {b.rowCount} แถว · ซ้ำ {b.duplicateCount}
                    </p>
                  </div>
                  <Badge kind={b.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="ยอดคงเหลือ"
          action={
            <Link href="/reconcile" className="text-sm text-brand hover:underline">
              กระทบยอด
            </Link>
          }
        >
          {(summary?.balances ?? []).length === 0 ? (
            <Empty>ยังไม่มีบัญชีในระบบ</Empty>
          ) : (
            <>
              <ul className="divide-y divide-black/5">
                {summary!.balances.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-3">
                    <span className="text-sm">{a.name}</span>
                    <span className="tabular text-sm font-medium">
                      {formatMoney(a.computedBalance)}
                    </span>
                  </li>
                ))}
              </ul>
              {offBalance.length > 0 && (
                <p className="mt-3 rounded-xl bg-warn/10 px-3 py-2 text-xs text-warn">
                  มี {offBalance.length} บัญชีที่ยอดไม่ตรงกับสเตทเมนต์ — แปลว่ามีรายการหายหรือเกิน
                </p>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
