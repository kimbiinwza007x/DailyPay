/**
 * Domain types ที่ทั้ง Nest และ Next ใช้ร่วมกัน
 * ตรงกับ dataclass เดิมใน finance/core/models.py และคอลัมน์ใน 001_schema.sql
 *
 * เงินทุกก้อนเป็น string ในชั้นนี้ ไม่ใช่ number — JS number เป็น float64
 * ยอด 0.1 + 0.2 ไม่เท่ากับ 0.3 (design.md ข้อ 3: ห้ามใช้ float กับเงิน)
 * ฝั่ง Nest แปลงเป็น Decimal, ฝั่ง Next แค่แสดงผล
 */

export type DedupeKind = 'new' | 'duplicate' | 'review';
export type BatchStatus = 'parsing' | 'review' | 'committed' | 'reverted' | 'failed';
export type BatchSource = 'csv' | 'statement_pdf' | 'slip_image' | 'manual';
export type ParseStatus = 'pending' | 'parsed' | 'duplicate' | 'skipped' | 'error';
export type AccountType = 'bank' | 'credit_card' | 'cash' | 'ewallet' | 'investment';
export type CategoryKind = 'expense' | 'income' | 'transfer';
export type MatchField = 'description_raw' | 'counterparty' | 'amount';
export type MatchType = 'contains' | 'regex' | 'exact' | 'amount_range';

/** ผลจาก parser หนึ่งแถว ก่อนกันซ้ำ/จัดหมวด (= ParsedRow ใน core/models.py) */
export interface ParsedRowDto {
  /** วันตามเวลาไทย (YYYY-MM-DD) — ใช้ group เดือนจากตัวนี้เท่านั้น */
  bookedDate: string;
  /** ติดลบ = เงินออก, บวก = เงินเข้า */
  amount: string;
  occurredAt?: string | null;
  descriptionRaw?: string | null;
  counterparty?: string | null;
  /** เลขอ้างอิงธนาคาร หรือ qr_payload จากสลิป */
  bankRef?: string | null;
  balanceAfter?: string | null;
  confidence: number;
  /** แถวดิบจากไฟล์ เก็บลง raw_rows.payload ตลอดชีพ */
  payload: Record<string, unknown>;
}

export interface VerdictDto {
  kind: DedupeKind;
  dupOf?: string | null;
  reason: string;
}

export interface StageResultDto {
  batchId: string;
  duplicateFile: boolean;
}

export interface CommitResultDto {
  batchId: string;
  inserted: number;
}

export interface AccountDto {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  last4: string | null;
  openingBalance: string;
  archivedAt: string | null;
}

export interface CategoryDto {
  id: string;
  code: string | null;
  parentId: string | null;
  name: string;
  kind: CategoryKind;
  icon: string | null;
  /** 'อาหาร › ทานนอกบ้าน' */
  path: string;
}

export interface BatchSummaryDto {
  id: string;
  fileName: string | null;
  source: BatchSource;
  status: BatchStatus;
  rowCount: number;
  importedCount: number;
  duplicateCount: number;
  reviewCount: number;
  errorMessage: string | null;
  createdAt: string;
  committedAt: string | null;
}

export interface ReviewRowDto {
  id: string;
  lineNo: number | null;
  parsed: ParsedRowDto | null;
  dedupe: DedupeKind | null;
  dupOf: string | null;
  proposedCategoryId: string | null;
  proposedCategoryName: string | null;
  confidence: string | null;
  parseStatus: ParseStatus;
  parseError: string | null;
}

export interface BatchDetailDto {
  batch: BatchSummaryDto;
  rows: ReviewRowDto[];
}

export interface CategoryTotalDto {
  month: string;
  categoryId: string | null;
  categoryPath: string;
  kind: CategoryKind | null;
  total: string;
  txCount: number;
}

export interface MonthlyReportDto {
  month: string;
  income: string;
  expense: string;
  net: string;
  byCategory: CategoryTotalDto[];
}

export interface AccountBalanceDto {
  id: string;
  name: string;
  computedBalance: string;
  statementBalance: string | null;
  statementAsOf: string | null;
  /** ไม่เป็นศูนย์ = มีรายการหายหรือเกิน ต้องไล่หา */
  diff: string | null;
}

export interface LedgerEntryDto {
  id: string;
  accountId: string;
  accountName: string;
  bookedDate: string;
  occurredAt: string | null;
  amount: string;
  descriptionRaw: string | null;
  counterparty: string | null;
  categoryId: string | null;
  categoryPath: string | null;
  bankRef: string | null;
  needsReview: boolean;
  note: string | null;
}
