/**
 * zod schema ที่ใช้ validate ขาเข้าของ API และ reuse เป็น form validation ฝั่ง web
 * เก็บไว้ที่เดียวเพื่อไม่ให้ contract สองฝั่งเลื่อนออกจากกัน
 */
import { z } from 'zod';

/** ยอดเงินเป็นสตริงเสมอ: -1250.00 (ติดลบ = เงินออก) */
export const moneyString = z
  .string()
  .regex(/^-?\d{1,12}(\.\d{1,2})?$/, 'รูปแบบจำนวนเงินไม่ถูกต้อง');

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ต้องเป็นรูปแบบ YYYY-MM-DD');

export const uuid = z.string().uuid('ต้องเป็น UUID');

export const stageUploadSchema = z.object({
  accountId: uuid.optional(),
});

/** ค่าที่ผู้ใช้แก้ในหน้าตรวจ — key ของ object นี้จะถูกเซ็ตเป็น locked_fields ตรง ๆ */
export const rowOverrideSchema = z
  .object({
    booked_date: isoDate.optional(),
    amount: moneyString.optional(),
    description_raw: z.string().max(500).nullable().optional(),
    counterparty: z.string().max(200).nullable().optional(),
    category_id: uuid.nullable().optional(),
    note: z.string().max(1000).nullable().optional(),
  })
  .strict();

export const commitBatchSchema = z.object({
  accountId: uuid,
  /** { "<raw_row_id>": { category_id: "...", note: "..." } } */
  overrides: z.record(uuid, rowOverrideSchema).default({}),
  /** raw_row_id ที่ผู้ใช้ติ๊กว่า "ไม่ต้องนำเข้า" */
  skipRowIds: z.array(uuid).default([]),
});

export const monthQuerySchema = z.object({
  /** YYYY-MM */
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export const createAccountSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['bank', 'credit_card', 'cash', 'ewallet', 'investment']),
  currency: z.string().length(3).default('THB'),
  last4: z.string().regex(/^\d{4}$/).nullable().optional(),
  openingBalance: moneyString.default('0'),
  statementDay: z.number().int().min(1).max(31).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

export const ledgerQuerySchema = z.object({
  accountId: uuid.optional(),
  categoryId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  needsReview: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export type StageUploadInput = z.infer<typeof stageUploadSchema>;
export type RowOverride = z.infer<typeof rowOverrideSchema>;
export type CommitBatchInput = z.infer<typeof commitBatchSchema>;
export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;
