/**
 * เทส core/dedupe ด้วย fake query — ไม่แตะ DB จริง
 * เคสสำคัญ: โอนยอดเท่ากันสองครั้งในนาทีเดียวกัน ต้องไม่กินรายการที่สองทิ้งแบบเงียบ ๆ
 */
import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { randomUUID } from 'node:crypto';
import { classify, type DedupeQueries } from '../src/core/dedupe';
import { fingerprint } from '../src/core/fingerprint';
import { makeParsedRow, type ParsedRow } from '../src/core/models';

const ACCOUNT = randomUUID();

class FakeQueries implements DedupeQueries {
  constructor(
    private readonly bankRefs: Record<string, string> = {},
    private readonly fingerprints: Record<string, string> = {},
    private readonly nearResult: string[] = [],
  ) {}

  async byBankRef(_accountId: string, bankRef: string): Promise<string | null> {
    return this.bankRefs[bankRef] ?? null;
  }
  async byFingerprint(fp: string): Promise<string | null> {
    return this.fingerprints[fp] ?? null;
  }
  async near(): Promise<string[]> {
    return this.nearResult;
  }
}

function makeRow(overrides: Partial<ParsedRow> = {}): ParsedRow {
  return makeParsedRow({
    bookedDate: '2025-09-12',
    amount: new Decimal('-60.00'),
    descriptionRaw: 'ร้านกาแฟ',
    confidence: 1.0,
    ...overrides,
  });
}

describe('dedupe.classify', () => {
  it('ไม่มีประวัติ = รายการใหม่', async () => {
    expect((await classify(makeRow(), ACCOUNT, new FakeQueries())).kind).toBe('new');
  });

  it('bank_ref ตรงกัน = ซ้ำ', async () => {
    const existing = randomUUID();
    const v = await classify(
      makeRow({ bankRef: 'QR123' }),
      ACCOUNT,
      new FakeQueries({ QR123: existing }),
    );
    expect(v.kind).toBe('duplicate');
    expect(v.dupOf).toBe(existing);
  });

  it('fingerprint ตรงกัน = ซ้ำ', async () => {
    const row = makeRow();
    const fp = fingerprint(ACCOUNT, row.bookedDate, row.amount, row.bankRef, row.descriptionRaw);
    const v = await classify(row, ACCOUNT, new FakeQueries({}, { [fp]: randomUUID() }));
    expect(v.kind).toBe('duplicate');
  });

  it('parse ไม่มั่นใจ = เข้าคิวตรวจ', async () => {
    const v = await classify(makeRow({ confidence: 0.3 }), ACCOUNT, new FakeQueries());
    expect(v.kind).toBe('review');
    expect(v.reason).toContain('ไม่มั่นใจ');
  });

  it('โอน 60 บาทสองครั้งในนาทีเดียวกัน ต้องเข้าคิวตรวจ ไม่ใช่ตัดสินเองว่าซ้ำ', async () => {
    // เวลาบนสลิปมีแค่ระดับนาที: ไม่มี bank_ref เหมือนกันเป๊ะ (คนละ QR)
    // แต่ fingerprint อาจไม่ตรง (คนละ description) — ระบบต้องไม่ทิ้งรายการที่สอง
    const nearId = randomUUID();
    const v = await classify(
      makeRow({ bankRef: 'QR-second-transfer' }),
      ACCOUNT,
      new FakeQueries({}, {}, [nearId]),
    );
    expect(v.kind).toBe('review');
    expect(v.dupOf).toBe(nearId);
  });

  it('bank_ref ชนะการเทียบแบบใกล้เคียง', async () => {
    const existing = randomUUID();
    const v = await classify(
      makeRow({ bankRef: 'QR123' }),
      ACCOUNT,
      new FakeQueries({ QR123: existing }, {}, [randomUUID()]),
    );
    expect(v.kind).toBe('duplicate');
    expect(v.dupOf).toBe(existing);
  });

  it.each([0.0, 0.79])('confidence %s ต่ำกว่าเกณฑ์ = review', async (confidence) => {
    expect((await classify(makeRow({ confidence }), ACCOUNT, new FakeQueries())).kind).toBe(
      'review',
    );
  });

  it.each([0.8, 1.0])('confidence %s ถึงเกณฑ์ = new', async (confidence) => {
    expect((await classify(makeRow({ confidence }), ACCOUNT, new FakeQueries())).kind).toBe('new');
  });
});
