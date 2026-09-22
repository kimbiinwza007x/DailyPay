/**
 * Unit of work / transaction boundary
 * ทุกอย่างใน callback เดียวใช้ connection เดียวกัน commit อัตโนมัติถ้าไม่มี exception
 *
 * จุดสำคัญ (design.md ข้อ 7): การ enqueue job ต้องอยู่ใน transaction เดียวกับการ
 * สร้าง batch เสมอ — ถ้าใช้ Redis จะทำไม่ได้ งานถูก enqueue แล้วแต่ insert batch fail
 * กลายเป็น job ที่ชี้ไปยัง batch ที่ไม่มีอยู่
 */
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Db } from './pool';
import { BatchRepo } from './repos/batch.repo';
import { CategorizeRepo } from './repos/categorize.repo';
import { JobRepo } from './repos/job.repo';
import { RawRowRepo } from './repos/raw-row.repo';
import { TransactionRepo } from './repos/transaction.repo';

export class TxHandle {
  readonly batches: BatchRepo;
  readonly rawRows: RawRowRepo;
  readonly transactions: TransactionRepo;
  readonly jobs: JobRepo;
  readonly categorize: CategorizeRepo;

  constructor(readonly client: PoolClient) {
    this.batches = new BatchRepo(client);
    this.rawRows = new RawRowRepo(client);
    this.transactions = new TransactionRepo(client);
    this.jobs = new JobRepo(client);
    this.categorize = new CategorizeRepo(client);
  }

  async query<T extends object>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const res = await this.client.query(text, params);
    return res.rows as T[];
  }
}

@Injectable()
export class UnitOfWork {
  constructor(private readonly db: Db) {}

  async run<T>(fn: (tx: TxHandle) => Promise<T>): Promise<T> {
    return this.db.withClient(async (client) => {
      await client.query('begin');
      try {
        const result = await fn(new TxHandle(client));
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback');
        throw err;
      }
    });
  }

  /** อ่านอย่างเดียว ไม่ต้องเปิด transaction */
  async read<T>(fn: (tx: TxHandle) => Promise<T>): Promise<T> {
    return this.db.withClient((client) => fn(new TxHandle(client)));
  }
}
