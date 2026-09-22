/**
 * ตัวกันซ้ำระดับรายการ — ต้องคำนวณให้ตรงกับ tx_fingerprint() ใน 002_functions.sql
 * เป๊ะทุกตัวอักษร ไม่งั้น fingerprint ที่คำนวณฝั่ง Node (ตอนเสนอผล parse)
 * จะไม่ตรงกับที่ trigger คำนวณตอน insert จริง แล้ว dedupe ชั้น 3 จะพลาดเงียบ ๆ
 *
 * SQL ต้นฉบับ:
 *   sha256( account || '|' || to_char(date,'YYYYMMDD') || '|'
 *           || to_char(amount,'FM9999999990.00') || '|'
 *           || coalesce(nullif(trim(ref),''),
 *                       left(regexp_replace(lower(desc), '[^a-z0-9ก-๙]', '', 'g'), 24)) )
 */
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';

/**
 * ก-๙ = U+0E01..U+0E59 ครอบคลุมพยัญชนะ/สระ/วรรณยุกต์ไทย "และเลขไทย ๐-๙"
 * (เวอร์ชัน Python เดิมใช้ ก-๏ = U+0E01..U+0E4F ซึ่งตัดเลขไทยทิ้ง → ไม่ตรงกับ SQL
 *  ทำให้รายการที่มีเลขไทยในคำอธิบายได้ fingerprint คนละค่ากับที่ trigger คำนวณ)
 */
const NON_ALNUM_THAI = /[^a-z0-9\u0E01-\u0E59]/g;

function normalizeDesc(desc: string | null | undefined): string {
  return (desc ?? '').toLowerCase().replace(NON_ALNUM_THAI, '').slice(0, 24);
}

/** เทียบเท่า to_char(amount, 'FM9999999990.00') ของ Postgres (ปัดแบบ half-up) */
function formatAmount(amount: Decimal): string {
  return amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** 'YYYY-MM-DD' → 'YYYYMMDD' เทียบเท่า to_char(date, 'YYYYMMDD') */
function formatDate(bookedDate: string): string {
  return bookedDate.replaceAll('-', '');
}

export function fingerprint(
  accountId: string,
  bookedDate: string,
  amount: Decimal,
  bankRef: string | null | undefined,
  descriptionRaw: string | null | undefined,
): string {
  const ref = (bankRef ?? '').trim();
  const keyTail = ref !== '' ? ref : normalizeDesc(descriptionRaw);
  const raw = [accountId, formatDate(bookedDate), formatAmount(amount), keyTail].join('|');
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}
