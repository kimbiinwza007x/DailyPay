/**
 * จุดเดียวที่เขียน transactions จริง
 * ยังไม่มีอะไรลง transactions จนกว่าจะ commit — ถ้าผิดก็เรียก revert_batch() ทิ้งทั้งก้อน
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CommitBatchInput, RowOverride } from '@dailypay/shared';
import type { CommitResult } from '../../core/models';
import { UnitOfWork } from '../../db/uow';

/** ฟิลด์ที่ยกจาก raw_rows.parsed มาลง transactions ได้ตรง ๆ */
const CARRIED_FIELDS: Record<string, string> = {
  bookedDate: 'booked_date',
  occurredAt: 'occurred_at',
  amount: 'amount',
  descriptionRaw: 'description_raw',
  counterparty: 'counterparty',
  bankRef: 'bank_ref',
  balanceAfter: 'balance_after',
};

@Injectable()
export class CommitService {
  private readonly log = new Logger(CommitService.name);

  constructor(private readonly uow: UnitOfWork) {}

  async commit(batchId: string, input: CommitBatchInput): Promise<CommitResult> {
    const { accountId, overrides, skipRowIds } = input;

    return this.uow.run(async (tx) => {
      // atomic ทั้งก้อน: ถ้าแถวใดแถวหนึ่งพัง ต้องไม่เหลือครึ่ง ๆ กลาง ๆ
      const batch = await tx.batches.get(batchId);
      if (batch.status !== 'review') {
        throw new NotFoundException(
          `batch ${batchId} อยู่สถานะ '${batch.status}' ไม่ใช่ 'review' จึง commit ไม่ได้`,
        );
      }

      const rows = await tx.rawRows.forCommit(batchId, skipRowIds);
      let inserted = 0;

      for (const r of rows) {
        const override: RowOverride = overrides[r.id] ?? {};
        const parsed = (r.parsed ?? {}) as Record<string, unknown>;

        const data: Record<string, unknown> = {};
        for (const [jsonKey, column] of Object.entries(CARRIED_FIELDS)) {
          const value = parsed[jsonKey];
          if (value !== undefined && value !== null) data[column] = value;
        }
        // ค่าที่ผู้ใช้แก้ในหน้าตรวจชนะค่าที่ parser เสนอเสมอ
        Object.assign(data, override);

        // ผู้ใช้กดยืนยันว่าไม่ซ้ำ (dup_of มีค่าแต่ยังเลือก commit)
        // ต้องให้ bank_ref ต่างจากใบเดิม ไม่งั้นชน unique index tx_dedupe
        if (r.dup_of && !data['bank_ref']) data['bank_ref'] = `manual#${r.id}`;

        await tx.transactions.insert({
          ...data,
          account_id: accountId,
          raw_row_id: r.id,
          import_batch_id: batchId,
          category_id: override.category_id ?? r.proposed_category_id ?? null,
          // อะไรที่ผู้ใช้แก้ในหน้าตรวจ ถือว่าล็อกทันที กัน re-import ทับทีหลัง
          locked_fields: Object.keys(override),
          needs_review: r.dedupe === 'review',
        });
        inserted += 1;
      }

      await tx.batches.markCommitted(batchId);
      // สองอย่างที่ต้องรันหลัง commit ไม่ใช่ตอนนำเข้า (design.md ข้อ 4):
      // ขาโอนเข้ากับขาโอนออกมักมาจากคนละไฟล์คนละเวลา ถ้ารันตอน insert จะจับไม่เจอ
      await tx.jobs.enqueue('pair_transfers', {});
      await tx.jobs.enqueue('reconcile', { account_id: accountId });

      this.log.log(`commit batch ${batchId}: เขียน ${inserted} รายการ`);
      return { batchId, inserted };
    });
  }

  async revert(batchId: string): Promise<number> {
    return this.uow.run(async (tx) => {
      const deleted = await tx.batches.revert(batchId);
      this.log.log(`revert batch ${batchId}: ลบ ${deleted} รายการ`);
      return deleted;
    });
  }
}
