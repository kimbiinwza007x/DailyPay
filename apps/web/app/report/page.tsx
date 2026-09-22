import Link from 'next/link';
import type { MonthlyReportDto } from '@dailypay/shared';
import { apiFetch } from '@/lib/api';
import { currentMonth, formatMonth, formatMoney } from '@/lib/format';
import { Card, Empty, ErrorNote, Stat } from '@/components/ui';

export const dynamic = 'force-dynamic';

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: raw } = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(raw ?? '') ? raw! : currentMonth();

  let report: MonthlyReportDto;
  try {
    report = await apiFetch<MonthlyReportDto>(`/reports/monthly?month=${month}`);
  } catch (e) {
    return <ErrorNote>{e instanceof Error ? e.message : String(e)}</ErrorNote>;
  }

  // v_monthly_by_category คืนยอดรวมต่อหมวด (amount ติดลบ = รายจ่าย) จึงแยกสองฝั่งด้วยเครื่องหมาย
  const expenses = report.byCategory
    .filter((c) => Number(c.total) < 0)
    .sort((a, b) => Number(a.total) - Number(b.total));
  const incomes = report.byCategory
    .filter((c) => Number(c.total) > 0)
    .sort((a, b) => Number(b.total) - Number(a.total));

  const biggestExpense = expenses[0] ? Math.abs(Number(expenses[0].total)) : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">รายงาน · {formatMonth(month)}</h1>
        <div className="flex gap-2 text-sm">
          <Link
            href={`/report?month=${shiftMonth(month, -1)}`}
            className="rounded-lg bg-white px-3 py-1.5 ring-1 ring-black/5 hover:text-brand"
          >
            ← เดือนก่อน
          </Link>
          <Link
            href={`/report?month=${shiftMonth(month, 1)}`}
            className="rounded-lg bg-white px-3 py-1.5 ring-1 ring-black/5 hover:text-brand"
          >
            เดือนถัดไป →
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="รายรับ" value={formatMoney(report.income)} tone="income" />
        <Stat label="รายจ่าย" value={formatMoney(report.expense)} tone="expense" />
        <Stat
          label="คงเหลือสุทธิ"
          value={formatMoney(report.net)}
          tone={Number(report.net) < 0 ? 'expense' : 'income'}
        />
      </div>

      <Card title="รายจ่ายแยกหมวด">
        {expenses.length === 0 ? (
          <Empty>ไม่มีรายจ่ายในเดือนนี้</Empty>
        ) : (
          <ul className="space-y-3">
            {expenses.map((c) => {
              const value = Math.abs(Number(c.total));
              const pct = biggestExpense > 0 ? (value / biggestExpense) * 100 : 0;
              return (
                <li key={`${c.categoryId ?? 'none'}-${c.categoryPath}`}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">{c.categoryPath}</span>
                    <span className="tabular whitespace-nowrap text-expense">
                      {formatMoney(c.total)}
                      <span className="ml-2 text-xs text-muted">{c.txCount} รายการ</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-canvas">
                    <div
                      className="h-1.5 rounded-full bg-expense"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="รายรับแยกหมวด">
        {incomes.length === 0 ? (
          <Empty>ไม่มีรายรับในเดือนนี้</Empty>
        ) : (
          <ul className="divide-y divide-black/5">
            {incomes.map((c) => (
              <li
                key={`${c.categoryId ?? 'none'}-${c.categoryPath}`}
                className="flex items-center justify-between py-2.5 text-sm"
              >
                <span className="truncate">{c.categoryPath}</span>
                <span className="tabular text-income">
                  {formatMoney(c.total)}
                  <span className="ml-2 text-xs text-muted">{c.txCount} รายการ</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-xs text-muted">
        ตัวเลขทั้งหมด query จาก <code>v_ledger</code> เท่านั้น จึงไม่นับการโอนระหว่างบัญชีตัวเอง
        และไม่นับรายการแม่ที่ถูกแยกเป็นหลายหมวดซ้ำกับลูก
      </p>
    </div>
  );
}
