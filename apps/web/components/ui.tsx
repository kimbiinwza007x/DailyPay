import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatMoney, isOutflow } from '@/lib/format';

export function Card({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="font-display text-base font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  tone = 'ink',
}: {
  label: string;
  value: string;
  tone?: 'ink' | 'income' | 'expense' | 'warn';
}) {
  const toneClass = {
    ink: 'text-ink',
    income: 'text-income',
    expense: 'text-expense',
    warn: 'text-warn',
  }[tone];
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      <p className="text-sm text-muted">{label}</p>
      <p className={`tabular font-display mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

/** ยอดติดลบ = เงินออก แสดงเป็นสีแดง, บวก = เขียว (signed amount ตลอดทั้งระบบ) */
export function Money({ value }: { value: string | null }) {
  if (value === null) return <span className="text-muted">—</span>;
  return (
    <span className={`tabular ${isOutflow(value) ? 'text-expense' : 'text-income'}`}>
      {formatMoney(value)}
    </span>
  );
}

const BADGE_TONE: Record<string, string> = {
  new: 'bg-income/10 text-income',
  duplicate: 'bg-muted/15 text-muted',
  review: 'bg-warn/15 text-warn',
  parsing: 'bg-info/15 text-info',
  committed: 'bg-income/10 text-income',
  reverted: 'bg-muted/15 text-muted',
  failed: 'bg-expense/10 text-expense',
};

const BADGE_LABEL: Record<string, string> = {
  new: 'นำเข้าได้',
  duplicate: 'ซ้ำ',
  review: 'รอตรวจ',
  parsing: 'กำลังแยกข้อมูล',
  committed: 'ยืนยันแล้ว',
  reverted: 'ยกเลิกแล้ว',
  failed: 'ล้มเหลว',
};

export function Badge({ kind }: { kind: string | null }) {
  if (!kind) return <span className="text-muted">—</span>;
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
        BADGE_TONE[kind] ?? 'bg-muted/15 text-muted'
      }`}
    >
      {BADGE_LABEL[kind] ?? kind}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted">{children}</p>;
}

export function ButtonLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-block rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
    >
      {children}
    </Link>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl bg-expense/10 px-4 py-3 text-sm text-expense">{children}</div>
  );
}
