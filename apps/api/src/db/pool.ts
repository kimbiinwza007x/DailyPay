import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient, types } from 'pg';
import { loadEnv } from '../config/env';

/**
 * numeric (OID 1700) กลับมาเป็น string เสมอ ไม่ใช่ number
 * node-pg แปลงเป็น float64 ให้โดยปริยาย ซึ่งทำให้ยอด 14 หลักเพี้ยนเงียบ ๆ
 * (design.md ข้อ 3: ห้ามใช้ float กับเงิน)
 */
types.setTypeParser(1700, (v) => v);
/** date (OID 1082) กลับมาเป็น 'YYYY-MM-DD' ไม่ใช่ Date ที่จะโดน timezone ของ process เลื่อน */
types.setTypeParser(1082, (v) => v);
/** int8 (OID 20) — jobs.id เป็น bigserial คืนเป็น string กันค่าเกิน Number.MAX_SAFE_INTEGER */
types.setTypeParser(20, (v) => v);

@Injectable()
export class Db implements OnModuleDestroy {
  private readonly log = new Logger(Db.name);
  readonly pool: Pool;

  constructor() {
    const env = loadEnv();
    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      // บน Vercel แต่ละ instance ของ function ถือ pool ของตัวเอง ถ้าตั้ง 10 แล้ว
      // มี 10 instance พร้อมกัน = 100 connection ชนเพดานของ Supabase ทันที
      max: env.PG_POOL_MAX,
      idleTimeoutMillis: 30_000,
      // Supabase บังคับ TLS แต่ใช้ certificate ที่ Node ไม่มี CA ให้โดยตรง
      ssl: env.DATABASE_URL.includes('localhost') ? undefined : { rejectUnauthorized: false },
    });
    this.pool.on('error', (err) => this.log.error(`pool error: ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /** query สั้น ๆ ที่ไม่ต้องอยู่ใน transaction */
  async query<T extends object>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const res = await this.pool.query(text, params);
    return res.rows as T[];
  }

  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }
}
