/**
 * fingerprint ฝั่ง Node ต้องตรงกับ tx_fingerprint() ใน SQL เป๊ะ
 * ไม่งั้น dedupe ชั้น 3 (สลิป vs statement) จะพลาดเงียบ ๆ
 *
 * ค่าที่คาดหวังคำนวณจากสูตรเดียวกับ SQL:
 *   sha256(account || '|' || YYYYMMDD || '|' || amount || '|' || ref-or-desc)
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { fingerprint } from '../src/core/fingerprint';

const ACCOUNT = '11111111-1111-1111-1111-111111111111';

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

describe('fingerprint', () => {
  it('ใช้ bank_ref เป็นกุญแจถ้ามี', () => {
    expect(fingerprint(ACCOUNT, '2025-09-12', new Decimal('-60'), 'QR123', 'ร้านกาแฟ')).toBe(
      sha256(`${ACCOUNT}|20250912|-60.00|QR123`),
    );
  });

  it('ไม่มี bank_ref ใช้คำอธิบายที่ normalize แล้ว 24 ตัวแรก', () => {
    expect(fingerprint(ACCOUNT, '2025-09-12', new Decimal('-60'), null, '7-ELEVEN #12345')).toBe(
      sha256(`${ACCOUNT}|20250912|-60.00|7eleven12345`),
    );
  });

  it('bank_ref ที่เป็นช่องว่างล้วนถือว่าไม่มี (เทียบเท่า nullif(trim(ref),""))', () => {
    expect(fingerprint(ACCOUNT, '2025-09-12', new Decimal('-60'), '   ', 'ก')).toBe(
      fingerprint(ACCOUNT, '2025-09-12', new Decimal('-60'), null, 'ก'),
    );
  });

  it('เก็บเลขไทยไว้ในคำอธิบาย (ช่วง ก-๙ ตาม SQL ไม่ใช่ ก-๏)', () => {
    // ๙ = U+0E59 อยู่ในช่วงที่ SQL เก็บไว้ ถ้าตัดทิ้งจะได้ hash คนละค่ากับ trigger
    expect(fingerprint(ACCOUNT, '2025-09-12', new Decimal('-60'), null, 'ห้อง ๙')).toBe(
      sha256(`${ACCOUNT}|20250912|-60.00|ห้อง๙`),
    );
  });

  it('ปัดทศนิยมแบบ half-up เหมือน to_char(...,"FM9999999990.00")', () => {
    expect(fingerprint(ACCOUNT, '2025-09-12', new Decimal('-60.005'), 'R', null)).toBe(
      sha256(`${ACCOUNT}|20250912|-60.01|R`),
    );
  });

  it('ตัดคำอธิบายที่ normalize แล้วไว้ 24 ตัว', () => {
    const long = 'a'.repeat(50);
    expect(fingerprint(ACCOUNT, '2025-09-12', new Decimal('1'), null, long)).toBe(
      sha256(`${ACCOUNT}|20250912|1.00|${'a'.repeat(24)}`),
    );
  });
});
