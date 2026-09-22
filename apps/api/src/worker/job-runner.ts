/**
 * Worker loop: claim งานจาก jobs table ด้วย for update skip locked
 * รันหลายตัวขนานได้โดยไม่แย่งงานกัน และงานไม่หายถ้า worker ตาย (ยังอยู่ในคิว ไม่ locked)
 *
 * ยังใช้ Postgres เป็นคิวเหมือนเดิม ไม่ย้ายไป Redis/BullMQ เพราะ enqueue ต้องอยู่ใน
 * transaction เดียวกับ insert batch (design.md ข้อ 7)
 */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Db } from '../db/pool';
import { QueueKicker } from './queue-kicker';
import { UnitOfWork } from '../db/uow';
import {
  CLAIM_SQL,
  type JobRow,
  MARK_DONE_SQL,
  MARK_FAILED_SQL,
  RECLAIM_STALE_SQL,
} from '../db/repos/job.repo';
import { ImportService } from '../modules/import/import.service';

type JobHandler = (args: Record<string, unknown>) => Promise<void>;

@Injectable()
export class JobRunner implements OnModuleInit {
  private readonly log = new Logger(JobRunner.name);
  private readonly handlers: Record<string, JobHandler>;
  private stopped = false;

  constructor(
    private readonly db: Db,
    private readonly uow: UnitOfWork,
    private readonly importService: ImportService,
    private readonly kicker: QueueKicker,
  ) {
    this.handlers = {
      parse_batch: async (args) => {
        const batchId = args['batch_id'];
        if (typeof batchId !== 'string') throw new Error('parse_batch ต้องมี batch_id');
        await this.importService.parse(batchId);
      },

      // ขาโอนเข้ากับขาโอนออกมักมาจากคนละไฟล์คนละเวลา รันหลัง commit เท่านั้น
      pair_transfers: async () => {
        const pairs = await this.uow.run((tx) => tx.transactions.pairTransfers());
        this.log.log(`pair_transfers: จับคู่ได้ ${pairs} คู่`);
      },

      // กระทบยอด: diff ไม่เป็นศูนย์แปลว่ามีรายการหายหรือเกิน
      reconcile: async (args) => {
        const accountId = typeof args['account_id'] === 'string' ? args['account_id'] : null;
        const rows = await this.uow.read((tx) =>
          tx.query<{ id: string; name: string; diff: string | null }>(
            `select id, name, diff from v_account_balance
              where ($1::uuid is null or id = $1)`,
            [accountId],
          ),
        );
        for (const r of rows) {
          if (r.diff !== null && Number(r.diff) !== 0) {
            this.log.warn(`บัญชี ${r.name} ยอดไม่ตรงกับสเตทเมนต์ diff=${r.diff}`);
          }
        }
      },
    };
  }

  onModuleInit(): void {
    this.kicker.register(() => this.drain());
  }

  /** claim งานหนึ่งชิ้นแล้วรัน คืน true ถ้ามีงานให้ทำ, false ถ้าคิวว่าง */
  async runOnce(): Promise<boolean> {
    const job = await this.db.withClient(async (client) => {
      await client.query('begin');
      try {
        const { rows } = await client.query<JobRow>(CLAIM_SQL);
        await client.query('commit');
        return rows[0] ?? null;
      } catch (err) {
        await client.query('rollback');
        throw err;
      }
    });

    if (!job) return false;

    const handler = this.handlers[job.kind];
    if (!handler) {
      await this.db.query(MARK_FAILED_SQL, [`ไม่รู้จัก job kind: ${job.kind}`, job.id]);
      return true;
    }

    try {
      await handler(job.args ?? {});
      await this.db.query(MARK_DONE_SQL, [job.id]);
    } catch (err) {
      // งานเดียวพังต้องไม่ทำให้ worker ตาย
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(`job ${job.id} (${job.kind}) ล้มเหลว: ${message}`);
      await this.db.query(MARK_FAILED_SQL, [message, job.id]);
    }
    return true;
  }

  async runForever(pollIntervalMs: number): Promise<void> {
    this.log.log('worker เริ่มทำงาน');
    let ticks = 0;
    while (!this.stopped) {
      try {
        // ทุก ๆ ~5 นาทีของการรอ ปลดล็อกงานที่ worker ตัวเก่าตายคาไว้
        if (ticks % 150 === 0) await this.db.query(RECLAIM_STALE_SQL);
        const had = await this.runOnce();
        if (!had) {
          ticks += 1;
          await new Promise((r) => setTimeout(r, pollIntervalMs));
        }
      } catch (err) {
        this.log.error(`worker loop error: ${String(err)}`);
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }
    }
  }

  /**
   * ทำงานในคิวจนหมดหรือจนหมดงบเวลา แล้วคืนจำนวนชิ้นที่ทำ
   * ใช้แทน runForever บน serverless: ถูกเรียกหลัง enqueue, จาก cron และจากปุ่มในหน้าเว็บ
   *
   * งบเวลาต้องน้อยกว่า maxDuration ของ Vercel (300 วินาที) พอสมควร
   * ถ้างานถูกตัดกลางทาง job จะค้างสถานะ locked จน RECLAIM_STALE ปลดให้ (10 นาที)
   */
  async drain(budgetMs = 240_000): Promise<number> {
    const deadline = Date.now() + budgetMs;
    await this.db.query(RECLAIM_STALE_SQL);

    let done = 0;
    while (Date.now() < deadline) {
      const had = await this.runOnce();
      if (!had) break;
      done += 1;
    }
    return done;
  }

  stop(): void {
    this.stopped = true;
  }
}
