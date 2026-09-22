import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { randomUUID } from 'node:crypto';
import { type CategorizeQueries, type Rule, suggest } from '../src/core/categorize';
import { makeParsedRow } from '../src/core/models';

const CAT_TRANSFER = randomUUID();
const CAT_GROCERY = randomUUID();

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: randomUUID(),
    matchField: 'description_raw',
    matchType: 'contains',
    pattern: 'CREDIT CARD PAYMENT',
    amountMin: null,
    amountMax: null,
    setCategoryId: CAT_TRANSFER,
    setMerchantId: null,
    ...overrides,
  };
}

class FakeQueries implements CategorizeQueries {
  constructor(
    private readonly rules: Rule[] = [],
    private readonly aliasHits: Record<string, string> = {},
  ) {}
  async activeRules(): Promise<Rule[]> {
    return this.rules;
  }
  async merchantCategoryByAlias(text: string): Promise<string | null> {
    const key = Object.keys(this.aliasHits).find((a) => text.includes(a));
    return key ? this.aliasHits[key]! : null;
  }
}

const row = (desc: string, amount = '-100') =>
  makeParsedRow({ bookedDate: '2025-09-12', amount: new Decimal(amount), descriptionRaw: desc });

describe('categorize.suggest', () => {
  it('rule ชนะ merchant dictionary เสมอ', async () => {
    const q = new FakeQueries([rule()], { 'CREDIT CARD': CAT_GROCERY });
    expect(await suggest(row('CREDIT CARD PAYMENT 1234'), q)).toBe(CAT_TRANSFER);
  });

  it('ไม่มี rule ตรง ตกไปที่ merchant alias', async () => {
    const q = new FakeQueries([], { '7-ELEVEN': CAT_GROCERY });
    expect(await suggest(row('7-ELEVEN 12345'), q)).toBe(CAT_GROCERY);
  });

  it('regex ที่ผู้ใช้ตั้งเองพัง ต้องไม่ทำให้ทั้ง batch ล้ม', async () => {
    const q = new FakeQueries([rule({ matchType: 'regex', pattern: '[unclosed' })]);
    expect(await suggest(row('อะไรก็ได้'), q)).toBeNull();
  });

  it('amount_range เทียบด้วย Decimal ไม่ใช่ float', async () => {
    const q = new FakeQueries([
      rule({
        matchType: 'amount_range',
        amountMin: new Decimal('-150'),
        amountMax: new Decimal('-50'),
      }),
    ]);
    expect(await suggest(row('อะไรก็ได้', '-100'), q)).toBe(CAT_TRANSFER);
    expect(await suggest(row('อะไรก็ได้', '-200'), q)).toBeNull();
  });

  it('ไม่เจออะไรเลยและไม่มี LLM = null (ไม่เดามั่ว)', async () => {
    expect(await suggest(row('ร้านที่ไม่เคยเจอ'), new FakeQueries())).toBeNull();
  });

  it('เรียก LLM เป็นด่านสุดท้ายเท่านั้น', async () => {
    let called = 0;
    const llm = {
      async classify() {
        called += 1;
        return CAT_GROCERY;
      },
    };
    expect(await suggest(row('ร้านใหม่'), new FakeQueries(), llm)).toBe(CAT_GROCERY);
    expect(called).toBe(1);

    await suggest(row('7-ELEVEN'), new FakeQueries([], { '7-ELEVEN': CAT_GROCERY }), llm);
    expect(called).toBe(1);
  });
});
