/**
 * แยก "ตัดสิน" ออกจาก "ลงมือ" — classify() เป็น pure function
 * รับ query interface เข้ามา ไม่แตะ DB เอง เพื่อให้เทสได้ด้วย fake ไม่กี่บรรทัด
 * นี่คือส่วนที่จะพังเงียบที่สุดถ้าไม่มีเทส (design.md ข้อ 7)
 */
import Decimal from 'decimal.js';
import { fingerprint } from './fingerprint';
import { type ParsedRow, type Verdict, verdict } from './models';

export const CONFIDENCE_THRESHOLD = 0.8;

export interface DedupeQueries {
  /** หา transaction ที่ bank_ref ตรงกัน (รวม qr_payload ที่ยัดใส่ bank_ref) */
  byBankRef(accountId: string, bankRef: string): Promise<string | null>;
  /** หา transaction ที่ fingerprint ตรงกัน */
  byFingerprint(fp: string): Promise<string | null>;
  /** หา transaction ที่ยอด/วันใกล้เคียง (ไม่ตรงเป๊ะ) เรียงจากใกล้สุด */
  near(
    accountId: string,
    bookedDate: string,
    amount: Decimal,
    days?: number,
  ): Promise<string[]>;
}

export async function classify(
  row: ParsedRow,
  accountId: string,
  q: DedupeQueries,
): Promise<Verdict> {
  // ชั้น 2: bank_ref (รวม qr_payload) — แม่นที่สุด ถ้ามีก็จบ
  if (row.bankRef) {
    const hit = await q.byBankRef(accountId, row.bankRef);
    if (hit) return verdict('duplicate', hit, 'bank_ref ตรงกัน');
  }

  // ชั้น 3: fingerprint
  const fp = fingerprint(accountId, row.bookedDate, row.amount, row.bankRef, row.descriptionRaw);
  const fpHit = await q.byFingerprint(fp);
  if (fpHit) return verdict('duplicate', fpHit, 'fingerprint ตรงกัน');

  // ชั้น 4: ใกล้เคียง — ห้ามตัดสินเอง ให้คนยืนยัน
  const near = await q.near(accountId, row.bookedDate, row.amount, 1);
  if (near.length > 0) {
    return verdict('review', near[0]!, `คล้ายกับ ${near.length} รายการที่มีอยู่`);
  }

  if (row.confidence >= CONFIDENCE_THRESHOLD) return verdict('new');
  return verdict('review', null, 'parse ไม่มั่นใจ');
}
