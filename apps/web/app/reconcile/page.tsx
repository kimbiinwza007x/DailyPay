import type { AccountBalanceDto } from '@dailypay/shared';
import { apiFetch } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { Card, Empty, ErrorNote } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ReconcilePage() {
  let balances: AccountBalanceDto[];
  try {
    balances = await apiFetch<AccountBalanceDto[]>('/reports/reconcile');
  } catch (e) {
    return <ErrorNote>{e instanceof Error ? e.message : String(e)}</ErrorNote>;
  }

  const off = balances.filter((b) => b.diff !== null && Number(b.diff) !== 0);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-semibold">กระทบยอด</h1>

      {off.length > 0 && (
        <div className="rounded-xl bg-warn/10 px-4 py-3 text-sm text-warn">
          มี {off.length} บัญชีที่ยอดคำนวณไม่ตรงกับสเตทเมนต์ล่าสุด — แปลว่ามีรายการหายหรือเกิน
          ต้องไล่หาว่าขาดไฟล์ช่วงไหน
        </div>
      )}

      <Card>
        {balances.length === 0 ? (
          <Empty>ยังไม่มีบัญชีในระบบ</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">บัญชี</th>
                  <th className="py-2 pr-3 text-right font-medium">ยอดที่คำนวณได้</th>
                  <th className="py-2 pr-3 text-right font-medium">ยอดตามสเตทเมนต์</th>
                  <th className="py-2 pr-3 font-medium">ณ วันที่</th>
                  <th className="py-2 text-right font-medium">ส่วนต่าง</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {balances.map((b) => {
                  const diff = b.diff === null ? null : Number(b.diff);
                  return (
                    <tr key={b.id}>
                      <td className="py-2.5 pr-3 font-medium">{b.name}</td>
                      <td className="tabular py-2.5 pr-3 text-right">
                        {formatMoney(b.computedBalance)}
                      </td>
                      <td className="tabular py-2.5 pr-3 text-right">
                        {formatMoney(b.statementBalance)}
                      </td>
                      <td className="py-2.5 pr-3 text-muted">{formatDate(b.statementAsOf)}</td>
                      <td
                        className={
                          'tabular py-2.5 text-right font-medium ' +
                          (diff === null
                            ? 'text-muted'
                            : diff === 0
                              ? 'text-income'
                              : 'text-expense')
                        }
                      >
                        {diff === null ? 'ยังไม่มีสเตทเมนต์' : formatMoney(b.diff)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-muted">
        ส่วนต่างคำนวณจาก <code>v_account_balance</code>: ยอดตั้งต้น + ผลรวมรายการทั้งหมดที่ไม่ถูก
        void เทียบกับ <code>balance_snapshots</code> แถวล่าสุดของแต่ละบัญชี
      </p>
    </div>
  );
}
