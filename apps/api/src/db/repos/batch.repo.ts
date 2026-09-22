import type { PoolClient } from 'pg';
import type { BatchSource, BatchStatus } from '@dailypay/shared';

export interface BatchRow {
  id: string;
  account_id: string | null;
  source: BatchSource;
  file_name: string | null;
  file_hash: string;
  file_uri: string | null;
  status: BatchStatus;
  error_message: string | null;
  row_count: number;
  imported_count: number;
  duplicate_count: number;
  review_count: number;
  created_at: Date;
  committed_at: Date | null;
}

const COLUMNS = `id, account_id, source, file_name, file_hash, file_uri, status,
                 error_message, row_count, imported_count, duplicate_count,
                 review_count, created_at, committed_at`;

export class BatchRepo {
  constructor(private readonly c: PoolClient) {}

  async byHash(fileHash: string): Promise<BatchRow | null> {
    const { rows } = await this.c.query<BatchRow>(
      `select ${COLUMNS} from import_batches where file_hash = $1`,
      [fileHash],
    );
    return rows[0] ?? null;
  }

  async create(input: {
    accountId: string | null;
    fileName: string | null;
    fileHash: string;
    fileUri: string | null;
    source: BatchSource;
    status: BatchStatus;
  }): Promise<BatchRow> {
    const { rows } = await this.c.query<BatchRow>(
      `insert into import_batches (account_id, file_name, file_hash, file_uri, source, status)
       values ($1, $2, $3, $4, $5, $6)
       returning ${COLUMNS}`,
      [
        input.accountId,
        input.fileName,
        input.fileHash,
        input.fileUri,
        input.source,
        input.status,
      ],
    );
    return rows[0]!;
  }

  async get(batchId: string): Promise<BatchRow> {
    const { rows } = await this.c.query<BatchRow>(
      `select ${COLUMNS} from import_batches where id = $1`,
      [batchId],
    );
    const row = rows[0];
    if (!row) throw new Error(`batch ไม่พบ: ${batchId}`);
    return row;
  }

  async setSource(batchId: string, source: BatchSource): Promise<void> {
    await this.c.query('update import_batches set source = $1 where id = $2', [source, batchId]);
  }

  async fail(batchId: string, errorMessage: string): Promise<void> {
    await this.c.query(
      `update import_batches set status = 'failed', error_message = $1 where id = $2`,
      [errorMessage, batchId],
    );
  }

  async toReview(batchId: string, counts: Record<string, number>): Promise<void> {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    await this.c.query(
      `update import_batches
          set status = 'review',
              row_count = $1,
              imported_count = $2,
              duplicate_count = $3,
              review_count = $4
        where id = $5`,
      [total, counts['new'] ?? 0, counts['duplicate'] ?? 0, counts['review'] ?? 0, batchId],
    );
  }

  async markCommitted(batchId: string): Promise<void> {
    await this.c.query(
      `update import_batches set status = 'committed', committed_at = now() where id = $1`,
      [batchId],
    );
  }

  async listByStatus(status: BatchStatus | null, limit = 50): Promise<BatchRow[]> {
    const { rows } = await this.c.query<BatchRow>(
      `select ${COLUMNS} from import_batches
        where ($1::text is null or status = $1)
        order by created_at desc
        limit $2`,
      [status, limit],
    );
    return rows;
  }

  /** ยกเลิก batch ทั้งก้อน — ใช้ revert_batch() ใน 002_functions.sql ไม่เขียน SQL ซ้ำ */
  async revert(batchId: string): Promise<number> {
    const { rows } = await this.c.query<{ revert_batch: number }>(
      'select revert_batch($1) as revert_batch',
      [batchId],
    );
    return Number(rows[0]?.revert_batch ?? 0);
  }
}
