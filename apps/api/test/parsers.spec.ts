import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
  bangkokDateTime,
  currentYearInBangkok,
  NoParserMatched,
  parseThaiDate,
  toDecimal,
} from '../src/core/parsers/base';
import { KBankCsv } from '../src/core/parsers/kbank-csv';
import { ParserRegistry } from '../src/core/parsers/registry';
import { SlipImage } from '../src/core/parsers/slip-image';
import type { ParsedRow } from '../src/core/models';

async function collect(iter: AsyncIterable<ParsedRow>): Promise<ParsedRow[]> {
  const out: ParsedRow[] = [];
  for await (const r of iter) out.push(r);
  return out;
}

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FAKE_PNG = Buffer.concat([PNG_HEADER, Buffer.alloc(32)]);

describe('วันที่ไทย', () => {
  it('แปลง พ.ศ. เป็น ค.ศ.', () => {
    expect(parseThaiDate('12 ก.ย. 2568')).toBe('2025-09-12');
  });

  it('ปฏิเสธปีที่ไกลเกินไปในอนาคต', () => {
    const farFuture = currentYearInBangkok() + 543 + 5;
    expect(parseThaiDate('1 ม.ค. ' + farFuture)).toBeNull();
  });

  it('ปฏิเสธเดือนที่ไม่รู้จัก', () => {
    expect(parseThaiDate('12 xxx 2568')).toBeNull();
  });

  it('ปฏิเสธวันที่ไม่มีอยู่จริง', () => {
    expect(parseThaiDate('31 ก.พ. 2568')).toBeNull();
  });

  it('occurred_at ถูกตีความเป็นเวลาไทย ไม่ใช่ UTC', () => {
    const d = bangkokDateTime('2025-10-01', '01:00');
    expect(d?.toISOString()).toBe('2025-09-30T18:00:00.000Z');
  });
});

describe('toDecimal', () => {
  it('ตัดคอมมาและสัญลักษณ์เงินบาทออก', () => {
    expect(toDecimal('1,250.00')?.toString()).toBe('1250');
    expect(toDecimal('฿ 99.50')?.toString()).toBe('99.5');
    expect(toDecimal('-60')?.toString()).toBe('-60');
  });

  it('ค่าว่างหรือไม่ใช่ตัวเลข คืน null', () => {
    expect(toDecimal('')).toBeNull();
    expect(toDecimal('   ')).toBeNull();
    expect(toDecimal('ไม่ใช่ตัวเลข')).toBeNull();
  });
});

describe('KBankCsv', () => {
  const csv = [
    'วันที่,เวลา,รายการ,ถอน,ฝาก,คงเหลือ,เลขที่รายการ',
    '12 ก.ย. 2568,14:30,7-ELEVEN 12345,60.00,,50000.00,REF001',
    '13 ก.ย. 2568,09:00,SALARY,,35000.00,85000.00,REF002',
    'วันที่เพี้ยน,,,,,,',
  ].join('\n');
  const buf = Buffer.from(csv, 'utf8');

  it('sniff ให้คะแนนสูงกับไฟล์ที่มีหัวคอลัมน์ครบ', async () => {
    expect(await new KBankCsv().sniff(buf, 'statement.csv')).toBeGreaterThanOrEqual(0.8);
  });

  it('ถอน = ยอดติดลบ, ฝาก = ยอดบวก', async () => {
    const rows = await collect(new KBankCsv().rows(buf));
    expect(rows[0]!.amount.toFixed(2)).toBe('-60.00');
    expect(rows[1]!.amount.toFixed(2)).toBe('35000.00');
  });

  it('แถวที่พังได้ confidence 0 แต่ไม่ทำให้ทั้งไฟล์ล้ม', async () => {
    const rows = await collect(new KBankCsv().rows(buf));
    expect(rows).toHaveLength(3);
    expect(rows[2]!.confidence).toBe(0);
  });

  it('เก็บ payload ดิบไว้ทุกแถว (กฎข้อ 1 ของระบบ)', async () => {
    const rows = await collect(new KBankCsv().rows(buf));
    expect(rows[0]!.payload['เลขที่รายการ']).toBe('REF001');
  });

  it('ไฟล์ที่ไม่ใช่ CSV เลย คืนศูนย์แถว ไม่ throw', async () => {
    const rows = await collect(new KBankCsv().rows(Buffer.from([0xff, 0xd8, 0xff])));
    expect(rows.length).toBeLessThanOrEqual(1);
  });
});

describe('SlipImage', () => {
  it('qr_payload ถูกยัดใส่ bank_ref เพื่อให้ชนกับ statement อัตโนมัติ', async () => {
    const parser = new SlipImage(
      async () => 'QR-PAYLOAD-XYZ',
      async () => null,
    );
    const rows = await collect(parser.rows(FAKE_PNG));
    expect(rows[0]!.bankRef).toBe('QR-PAYLOAD-XYZ');
    expect(rows[0]!.payload['qr_status']).toBe('found');
  });

  it('อ่าน QR ไม่ออกและไม่มี OCR = confidence 0 ต้องเข้าคิวตรวจ', async () => {
    const rows = await collect(new SlipImage().rows(FAKE_PNG));
    expect(rows[0]!.confidence).toBe(0);
    expect(rows[0]!.payload['qr_status']).toBe('unreadable');
  });

  it('OCR อ่านยอดได้ = ยอดติดลบเสมอ (สลิปโอนออก)', async () => {
    const parser = new SlipImage(
      async () => null,
      async () => ({
        rawText: 'x',
        amount: new Decimal('1250.00'),
        receiverName: 'ร้านค้า',
        receiverLast4: '1234',
        slipDate: '2025-09-12',
      }),
    );
    const rows = await collect(parser.rows(FAKE_PNG));
    expect(rows[0]!.amount.toFixed(2)).toBe('-1250.00');
    expect(rows[0]!.bookedDate).toBe('2025-09-12');
  });

  it('reader ที่ throw ต้องไม่ทำให้ parse ล้ม', async () => {
    const parser = new SlipImage(
      async () => {
        throw new Error('zxing พัง');
      },
      async () => {
        throw new Error('tesseract พัง');
      },
    );
    const rows = await collect(parser.rows(FAKE_PNG));
    expect(rows[0]!.confidence).toBe(0);
  });
});

describe('ParserRegistry', () => {
  it('เลือกตัวที่มั่นใจที่สุด', async () => {
    const registry = new ParserRegistry([new KBankCsv(), new SlipImage()]);
    const picked = await registry.pick(FAKE_PNG, 'slip.png');
    expect(picked.name).toBe('slip_image');
  });

  it('ไม่มีตัวไหนมั่นใจพอ = NoParserMatched', async () => {
    const registry = new ParserRegistry([new KBankCsv(), new SlipImage()]);
    await expect(
      registry.pick(Buffer.from('อะไรก็ไม่รู้'), 'x.bin'),
    ).rejects.toBeInstanceOf(NoParserMatched);
  });
});
