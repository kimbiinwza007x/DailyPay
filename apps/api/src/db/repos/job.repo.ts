import type { PoolClient } from 'pg';

export interface JobRow {
  id: string;
  kind: string;
  args: Record<string, unknown>;
}

/** claim งานชิ้นเดียวแบบไม่แย่งกัน — for update skip locked ทำให้รัน worker หลายตัวขนานได้ */
export const CLAIM_SQL = `
update jobs set locked_at = now(), attempts = attempts + 1
 where id = (select id from jobs
              where done_at is null and locked_at is null
                and run_after <= now()
              order by run_after
              for update skip locked
              limit 1)
returning id, kind, args
`;

export const MARK_DONE_SQL = 'update jobs set done_at = now(), locked_at = null where id = $1';

/** ปล่อย lock แล้วเลื่อนเวลาออกไปแบบ backoff เชิงเส้น สูงสุด 3 นาที */
export const MARK_FAILED_SQL = `
update jobs
   set locked_at = null,
       last_error = $1,
       run_after = now() + (least(attempts, 6) * interval '30 seconds')
 where id = $2
`;

/** งานที่ถูก claim แล้ว worker ตายคาไว้ ต้องปลดล็อกให้ตัวอื่นหยิบต่อ */
export const RECLAIM_STALE_SQL = `
update jobs
   set locked_at = null
 where done_at is null
   and locked_at is not null
   and locked_at < now() - interval '10 minutes'
`;

export class JobRepo {
  constructor(private readonly c: PoolClient) {}

  async enqueue(kind: string, args: Record<string, unknown>): Promise<string> {
    const { rows } = await this.c.query<{ id: string }>(
      'insert into jobs (kind, args) values ($1, $2) returning id',
      [kind, JSON.stringify(args)],
    );
    return rows[0]!.id;
  }

  async pending(limit = 20): Promise<JobRow[]> {
    const { rows } = await this.c.query<JobRow>(
      'select id, kind, args from jobs where done_at is null order by run_after limit $1',
      [limit],
    );
    return rows;
  }
}
