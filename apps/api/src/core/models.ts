/**
 * Domain model ของชั้น core — ไม่ผูกกับ schema ของ DB และไม่ import อะไรจากชั้นนอก
 * (ทิศทางการพึ่งพา: modules → core ← db/adapters)
 */
import Decimal from 'decimal.js';
import type { DedupeKind } from '@dailypay/shared';

export type { DedupeKind };

/** ผลจาก parser หนึ่งแถว ก่อนกันซ้ำ/จัดหมวด */
export interface ParsedRow {
  /** วันตามเวลาไทยที่ freeze แล้ว — เก็บเป็น 'YYYY-MM-DD' ไม่ใช่ Date เพื่อกัน timezone เลื่อน */
  bookedDate: string;
  /** ติดลบ = เงินออก */
  amount: Decimal;
  occurredAt: Date | null;
  descriptionRaw: string | null;
  counterparty: string | null;
  /** เลขอ้างอิงธนาคาร หรือ qr_payload */
  bankRef: string | null;
  balanceAfter: Decimal | null;
  /** 0.0-1.0 แถวที่ parse พังให้ 0 ไม่ใช่โยน exception */
  confidence: number;
  /** แถวดิบจากไฟล์ ลง raw_rows.payload */
  payload: Record<string, unknown>;
}

export function makeParsedRow(
  init: Partial<ParsedRow> & Pick<ParsedRow, 'bookedDate' | 'amount'>,
): ParsedRow {
  return {
    occurredAt: null,
    descriptionRaw: null,
    counterparty: null,
    bankRef: null,
    balanceAfter: null,
    confidence: 1.0,
    payload: {},
    ...init,
  };
}

export interface Verdict {
  kind: DedupeKind;
  dupOf: string | null;
  reason: string;
}

export function verdict(kind: DedupeKind, dupOf: string | null = null, reason = ''): Verdict {
  return { kind, dupOf, reason };
}

export interface StageResult {
  batchId: string;
  duplicateFile: boolean;
}

export interface CommitResult {
  batchId: string;
  inserted: number;
}

/** แปลง ParsedRow เป็น json ที่เก็บลง raw_rows.parsed ได้ (Decimal/Date ไม่ serialize เอง) */
export function parsedRowToJson(row: ParsedRow): Record<string, unknown> {
  return {
    bookedDate: row.bookedDate,
    amount: row.amount.toFixed(2),
    occurredAt: row.occurredAt ? row.occurredAt.toISOString() : null,
    descriptionRaw: row.descriptionRaw,
    counterparty: row.counterparty,
    bankRef: row.bankRef,
    balanceAfter: row.balanceAfter ? row.balanceAfter.toFixed(2) : null,
    confidence: row.confidence,
  };
}
