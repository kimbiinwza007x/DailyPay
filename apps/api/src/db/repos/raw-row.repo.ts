import type { PoolClient } from 'pg';
import type { DedupeKind, ParseStatus } from '@dailypay/shared';

export interface RawRowRecord {
  id: string;
  batch_id: string;
  line_no: number | null;
  parsed: Record<string, unknown> | null;
  dedupe: DedupeKind | null;
  dup_of: string | null;
  proposed_category_id: string | null;
  proposed_category_name: string | null;
  confidence: string | null;
  parse_status: ParseStatus;
  parse_error: string | null;
}

export class RawRowRepo {
  constructor(private readonly c: PoolClient) {}

  async upsert(input: {
    batchId: string;
    lineNo: number;
    payload: Record<string, unknown>;
    rowHash: string;
    parsed: Record<string, unknown>;
    dedupe: DedupeKind;
    dupOf: string | null;
    proposedCategoryId: string | null;
    confidence: number;
    parseStatus: ParseStatus;
  }): Promise<void> {
    await this.c.query(
      `insert into raw_rows
           (batch_id, line_no, payload, row_hash, parsed, dedupe, dup_of,
            proposed_category_id, confidence, parse_status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (batch_id, row_hash) do update
          set parsed = excluded.parsed,
              dedupe = excluded.dedupe,
              dup_of = excluded.dup_of,
              proposed_category_id = excluded.proposed_category_id,
              confidence = excluded.confidence,
              parse_status = excluded.parse_status`,
      [
        input.batchId,
        input.lineNo,
        JSON.stringify(input.payload),
        input.rowHash,
        JSON.stringify(input.parsed),
        input.dedupe,
        input.dupOf,
        input.proposedCategoryId,
        input.confidence,
        input.parseStatus,
      ],
    );
  }

  async listForBatch(batchId: string): Promise<RawRowRecord[]> {
    const { rows } = await this.c.query<RawRowRecord>(
      `select r.id, r.batch_id, r.line_no, r.parsed, r.dedupe, r.dup_of,
              r.proposed_category_id,
              coalesce(p.name || ' › ', '') || c.name as proposed_category_name,
              r.confidence, r.parse_status, r.parse_error
         from raw_rows r
         left join categories c on c.id = r.proposed_category_id
         left join categories p on p.id = c.parent_id
        where r.batch_id = $1
        order by r.line_no`,
      [batchId],
    );
    return rows;
  }

  /** เฉพาะแถวที่จะเขียนลง transactions จริง: ตัด duplicate และแถวที่ผู้ใช้ติ๊กข้ามออก */
  async forCommit(batchId: string, skipRowIds: string[]): Promise<RawRowRecord[]> {
    const { rows } = await this.c.query<RawRowRecord>(
      `select id, batch_id, line_no, parsed, dedupe, dup_of, proposed_category_id,
              null::text as proposed_category_name, confidence, parse_status, parse_error
         from raw_rows
        where batch_id = $1
          and dedupe is distinct from 'duplicate'
          and parse_status <> 'error'
          and not (id = any($2::uuid[]))
        order by line_no`,
      [batchId, skipRowIds],
    );
    return rows;
  }
}
