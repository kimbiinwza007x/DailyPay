'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type {
  AccountDto,
  CategoryDto,
  CommitResultDto,
  ReviewRowDto,
  RowOverride,
} from '@dailypay/shared';
import { createClient } from '@/lib/supabase-browser';
import { formatDate, formatMoney, isOutflow } from '@/lib/format';
import { Badge } from '@/components/ui';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * ฟอร์มแก้ไขรายบรรทัดก่อน commit — ของที่แก้ตรงนี้จะถูกเซ็ตเป็น locked_fields
 * ทำให้ re-import ไฟล์ที่ช่วงเวลาทับกันไม่เขียนทับหมวดที่นั่งจัดมาทั้งเดือน
 */
export default function ReviewTable({
  batchId,
  rows,
  accounts,
  categories,
  defaultAccountId,
}: {
  batchId: string;
  rows: ReviewRowDto[];
  accounts: AccountDto[];
  categories: CategoryDto[];
  defaultAccountId: string | null;
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id ?? '');
  const [overrides, setOverrides] = useState<Record<string, RowOverride>>({});
  const [skipped, setSkipped] = useState<Set<string>>(
    // แถวที่ parse ไม่ผ่านถูกติ๊กข้ามไว้ให้ตั้งแต่แรก ผู้ใช้ค่อยเปิดกลับเองถ้าต้องการ
    () => new Set(rows.filter((r) => r.parseStatus === 'error').map((r) => r.id)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const committable = useMemo(
    () => rows.filter((r) => r.dedupe !== 'duplicate' && r.parseStatus !== 'error'),
    [rows],
  );
  const willInsert = committable.filter((r) => !skipped.has(r.id)).length;

  function setOverride(rowId: string, patch: RowOverride) {
    setOverrides((prev) => {
      const next: Record<string, unknown> = { ...prev[rowId], ...patch };
      // ค่าว่าง = ไม่ได้แก้ ต้องถอดออกจาก overrides ไม่งั้นจะไปล็อกฟิลด์ที่ผู้ใช้ไม่ได้ตั้งใจแก้
      for (const [k, v] of Object.entries(next)) {
        if (v === '' || v === undefined) delete next[k];
      }
      return { ...prev, [rowId]: next as RowOverride };
    });
  }

  function toggleSkip(rowId: string) {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  async function commit() {
    if (!accountId) {
      setError('ต้องเลือกบัญชีก่อนยืนยัน');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const cleanOverrides = Object.fromEntries(
        Object.entries(overrides).filter(([, v]) => Object.keys(v).length > 0),
      );

      const res = await fetch(API_URL + '/api/batches/' + batchId + '/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session ? { Authorization: 'Bearer ' + session.access_token } : {}),
        },
        body: JSON.stringify({
          accountId,
          overrides: cleanOverrides,
          skipRowIds: [...skipped],
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? res.statusText);
      }
      const result = (await res.json()) as CommitResultDto;
      router.push('/review?committed=' + result.inserted);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium">บัญชีปลายทาง</label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="rounded-xl border border-black/10 px-3 py-2 text-sm"
          >
            <option value="">— เลือกบัญชี —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <p className="pb-2 text-sm text-muted">
          จะเขียนลงระบบ <strong className="text-ink">{willInsert}</strong> รายการ
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-xs text-muted">
              <th className="py-2 pr-2 font-medium">นำเข้า</th>
              <th className="py-2 pr-3 font-medium">วันที่</th>
              <th className="py-2 pr-3 font-medium">รายละเอียด</th>
              <th className="py-2 pr-3 text-right font-medium">ยอด</th>
              <th className="py-2 pr-3 font-medium">หมวด</th>
              <th className="py-2 pr-3 font-medium">หมายเหตุ</th>
              <th className="py-2 font-medium">สถานะ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {rows.map((r) => {
              const parsed = r.parsed;
              const amount = parsed?.amount ?? null;
              const isDuplicate = r.dedupe === 'duplicate';
              const editable = !isDuplicate && r.parseStatus !== 'error';
              return (
                <tr key={r.id} className={isDuplicate ? 'opacity-50' : undefined}>
                  <td className="py-2 pr-2">
                    <input
                      type="checkbox"
                      disabled={!editable}
                      checked={editable && !skipped.has(r.id)}
                      onChange={() => toggleSkip(r.id)}
                      className="size-4"
                    />
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {editable ? (
                      <input
                        type="date"
                        defaultValue={parsed?.bookedDate ?? ''}
                        onChange={(e) => setOverride(r.id, { booked_date: e.target.value })}
                        className="rounded-lg border border-black/10 px-2 py-1 text-xs"
                      />
                    ) : (
                      formatDate(parsed?.bookedDate)
                    )}
                  </td>
                  <td className="max-w-[18rem] py-2 pr-3">
                    <p className="truncate">{parsed?.descriptionRaw ?? '—'}</p>
                    {parsed?.bankRef && (
                      <p className="truncate text-xs text-muted">ref: {parsed.bankRef}</p>
                    )}
                    {r.parseError && <p className="text-xs text-expense">{r.parseError}</p>}
                  </td>
                  <td
                    className={
                      'tabular py-2 pr-3 text-right whitespace-nowrap ' +
                      (amount && isOutflow(amount) ? 'text-expense' : 'text-income')
                    }
                  >
                    {formatMoney(amount)}
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      disabled={!editable}
                      defaultValue={r.proposedCategoryId ?? ''}
                      onChange={(e) => setOverride(r.id, { category_id: e.target.value || null })}
                      className="max-w-[12rem] rounded-lg border border-black/10 px-2 py-1 text-xs disabled:opacity-50"
                    >
                      <option value="">— ยังไม่จัดหมวด —</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.path}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="text"
                      disabled={!editable}
                      placeholder="—"
                      onChange={(e) => setOverride(r.id, { note: e.target.value })}
                      className="w-32 rounded-lg border border-black/10 px-2 py-1 text-xs disabled:opacity-50"
                    />
                  </td>
                  <td className="py-2 whitespace-nowrap">
                    <Badge kind={r.dedupe} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {error && <p className="text-sm text-expense">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={commit}
          disabled={busy || willInsert === 0}
          className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'กำลังยืนยัน…' : 'ยืนยันนำเข้า ' + willInsert + ' รายการ'}
        </button>
        <p className="text-xs text-muted">
          ช่องที่แก้เองจะถูกล็อกไว้ ไม่ถูกเขียนทับตอน re-import ไฟล์ที่ช่วงเวลาทับกัน
        </p>
      </div>
    </div>
  );
}
