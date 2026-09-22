/**
 * เทส parseSlipText ด้วย "ข้อความที่ tesseract อ่านออกมาจริง" จากสลิป 3 ค่าย
 * (fixtures-ocr.json ได้จากการรัน OCR กับไฟล์จริง ไม่ใช่ข้อความที่นั่งพิมพ์เอง)
 *
 * เหตุผลที่ต้องใช้ของจริง: ตอนเขียนรอบแรกผมสมมติว่า OCR อ่านสลิปได้สะอาด
 * ของจริงคือ 'ก.ย.' กลายเป็น 'ณย.' และยอดตัวใหญ่หายทั้งบรรทัด — เทสที่พิมพ์เอง
 * จะผ่านหมดโดยที่ระบบใช้งานจริงไม่ได้
 */
import { describe, expect, it } from 'vitest';
import { parseSlipText } from '../src/adapters/thai-ocr';
import fixtures from './fixtures-ocr.json';

/**
 * ท่อจริงยิง OCR สองรอบแล้วเอาข้อความมาต่อกัน (ภาพที่ปรับแล้วอ่านยอดได้ดี
 * ภาพต้นฉบับอ่านชื่อเดือนไทยได้ดี) เทสจึงต้องป้อนแบบเดียวกัน
 */
const merged = (f: { prepared: string; plain: string }): string => `${f.prepared}
${f.plain}`;

const KPLUS = merged(fixtures['1.jpg']);
const DIME = merged(fixtures['2.jpg']);
const TRUEMONEY = merged(fixtures['3.jpg']);

describe('สลิปจริง: K PLUS (เติมเงิน)', () => {
  const r = parseSlipText(KPLUS);

  it('อ่านยอด 100.00 ไม่ใช่ค่าธรรมเนียม 0.00', () => {
    expect(r.amount?.toFixed(2)).toBe('100.00');
  });

  it("อ่านวันที่ได้แม้ OCR เพี้ยน 'ก.ย.' เป็น 'ณย.' และปีเป็น 2 หลัก", () => {
    expect(r.slipDate).toBe('2026-09-13');
  });

  it('อ่านเลข 4 ตัวท้ายบัญชี', () => {
    expect(r.receiverLast4).toBe('9850');
  });
});

describe('สลิปจริง: Dime! (จ่ายบิล)', () => {
  const r = parseSlipText(DIME);

  it('อ่านยอด 240.49 ไม่ใช่ค่าธรรมเนียม 0.00 ที่อยู่บรรทัดบนกว่า', () => {
    expect(r.amount?.toFixed(2)).toBe('240.49');
  });

  it("อ่านวันที่ได้แม้ OCR เพี้ยน 'ก.ย.' เป็น 'กุย.'", () => {
    expect(r.slipDate).toBe('2026-09-07');
  });

  it('ดึงชื่อผู้รับจากบรรทัด "ไปยัง"', () => {
    expect(r.receiverName).toContain('TikTokShop');
  });
});

describe('สลิปจริง: TrueMoney', () => {
  const r = parseSlipText(TRUEMONEY);

  it('อ่านวันที่ได้', () => {
    expect(r.slipDate).toBe('2026-09-08');
  });

  it('ไม่หยิบเลขอ้างอิงยาว ๆ มาเป็นยอดเงิน', () => {
    // เลขที่อ้างอิง 50058115591652 ต้องไม่ถูกตีความเป็นจำนวนเงิน
    expect(r.amount?.toFixed(2)).not.toBe('50058115591652.00');
  });
});

describe('กับดักที่เคยทำให้บันทึกยอดผิด', () => {
  it('มีแต่ค่าธรรมเนียม = ไม่มียอด (ห้ามคืน 0.00)', () => {
    expect(parseSlipText('ค่าธรรมเนียม 0.00 บาท').amount).toBeNull();
  });

  it('ค่าธรรมเนียมที่ label กับตัวเลขอยู่คนละบรรทัด ก็ต้องข้าม', () => {
    const text = ['จํานวน:', '100.00 บาท', 'ค่าธรรมเนียม:', '25.00 บาท'].join('\n');
    expect(parseSlipText(text).amount?.toFixed(2)).toBe('100.00');
  });

  it('ยอดที่มีคำกำกับชนะยอดที่ลอยอยู่เฉย ๆ', () => {
    const text = ['1.00 บาท', 'จํานวน', '250.00 บาท'].join('\n');
    expect(parseSlipText(text).amount?.toFixed(2)).toBe('250.00');
  });

  it('รองรับหลักพันที่มีคอมมา', () => {
    expect(parseSlipText('จํานวน 1,250.00 บาท').amount?.toFixed(2)).toBe('1250.00');
  });

  it("'฿ 99.00' ที่ ฿ ถูกอ่านเป็นเลข 8 ยังอ่านยอดถูก", () => {
    expect(parseSlipText('8 99.00').amount?.toFixed(2)).toBe('99.00');
  });
});

describe('วันที่ไทยบนสลิป', () => {
  it.each([
    ['13 ก.ย. 69', '2026-09-13'],
    ['07 ก.ย. 2569 - 22:09 น.', '2026-09-07'],
    ['8 ก.ย. 2569 15:25:35', '2026-09-08'],
    ['1 มี.ค. 2568', '2025-03-01'],
    ['1 ม.ค. 2568', '2025-01-01'],
  ])('%s -> %s', (input, expected) => {
    expect(parseSlipText(input).slipDate).toBe(expected);
  });

  it('เดือนที่แปลไม่ออกคืน null ไม่เดามั่ว', () => {
    expect(parseSlipText('22 1.9. 2569 10:14').slipDate).toBeNull();
  });

  it('ปีที่ไกลเกินไปในอนาคตถือว่า parse ผิด', () => {
    expect(parseSlipText('1 ม.ค. 2999').slipDate).toBeNull();
  });
});

describe('ข้อความที่อ่านอะไรไม่ได้เลย', () => {
  it('คืน null ทุกช่อง ไม่ throw', () => {
    const r = parseSlipText('~~~ เละ ~~~');
    expect(r.amount).toBeNull();
    expect(r.receiverName).toBeNull();
    expect(r.slipDate).toBeNull();
  });
});
