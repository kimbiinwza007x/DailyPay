import type { PoolClient } from 'pg';
import Decimal from 'decimal.js';
import type { DedupeQueries } from '../../core/dedupe';

/** ฟิลด์ที่อนุญาตให้เขียนลง transactions — allow-list ไม่ใช่ blocklist เพื่อกัน SQL injection ทางชื่อคอลัมน์ */
const WRITABLE_COLUMNS = [
  'account_id',
  'parent_id',
  'raw_row_id',
  'import_batch_id',
  'occurred_at',
  'booked_date',
  'amount',
  'currency',
  'fx_rate',
  'description_raw',
  'counterparty',
  'merchant_id',
  'category_id',
  'bank_ref',
  'balance_after',
  'status',
  'needs_review',
  'locked_fields',
  'note',
] as const;

export type WritableColumn = (typeof WRITABLE_COLUMNS)[number];
/**
 * ฟิลด์ที่ประกอบมาจาก raw_rows.parsed ตอน runtime จึงเช็คของบังคับใน insert()
 * ไม่ใช่ในชนิดข้อมูล — ให้ error บอกชื่อฟิลด์ที่ขาดชัด ๆ แทนที่จะไปตกที่ constraint ของ DB
 */
export type TransactionInsert = Partial<Record<WritableColumn, unknown>> &
  Record<string, unknown>;

export class TransactionRepo implements DedupeQueries {
  constructor(private readonly c: PoolClient) {}

  async byBankRef(accountId: string, bankRef: string): Promise<string | null> {
    const { rows } = await this.c.query<{ id: string }>(
      `select id from transactions
        where account_id = $1 and bank_ref = $2 and status <> 'void'
        limit 1`,
      [accountId, bankRef],
    );
    return rows[0]?.id ?? null;
  }

  async byFingerprint(fingerprint: string): Promise<string | null> {
    const { rows } = await this.c.query<{ id: string }>(
      `select id from transactions
        where fingerprint = $1 and status <> 'void' and parent_id is null
        limit 1`,
      [fingerprint],
    );
    return rows[0]?.id ?? null;
  }

  async near(
    accountId: string,
    bookedDate: string,
    amount: Decimal,
    days = 1,
  ): Promise<string[]> {
    const { rows } = await this.c.query<{ id: string }>(
      `select id from transactions
        where account_id = $1
          and amount = $2::numeric
          and status <> 'void'
          and booked_date between $3::date - $4::int and $3::date + $4::int
        order by abs(booked_date - $3::date)`,
      [accountId, amount.toFixed(2), bookedDate, days],
    );
    return rows.map((r) => r.id);
  }

  async insert(fields: TransactionInsert): Promise<string> {
    const entries = Object.entries(fields).filter(
      ([k, v]) => v !== undefined && (WRITABLE_COLUMNS as readonly string[]).includes(k),
    );
    if (entries.length === 0) throw new Error('ไม่มีฟิลด์ให้เขียนลง transactions');

    for (const required of ['account_id', 'amount', 'booked_date'] as const) {
      if (fields[required] === undefined || fields[required] === null) {
        throw new Error(`transactions ต้องมี ${required}`);
      }
    }

    const columns = entries.map(([k]) => k);
    const values = entries.map(([, v]) => (v instanceof Decimal ? v.toFixed(2) : v));
    const placeholders = columns.map((_, i) => `$${i + 1}`);

    const { rows } = await this.c.query<{ id: string }>(
      `insert into transactions (${columns.join(', ')})
       values (${placeholders.join(', ')})
       returning id`,
      values,
    );
    return rows[0]!.id;
  }

  async pairTransfers(): Promise<number> {
    const { rows } = await this.c.query<{ pair_transfers: number }>(
      'select pair_transfers() as pair_transfers',
    );
    return Number(rows[0]?.pair_transfers ?? 0);
  }
}
