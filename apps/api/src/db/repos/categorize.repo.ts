import type { PoolClient } from 'pg';
import Decimal from 'decimal.js';
import type { MatchField, MatchType } from '@dailypay/shared';
import type { CategorizeQueries, Rule } from '../../core/categorize';

interface RuleRow {
  id: string;
  match_field: MatchField;
  match_type: MatchType;
  pattern: string;
  amount_min: string | null;
  amount_max: string | null;
  set_category_id: string | null;
  set_merchant_id: string | null;
}

export class CategorizeRepo implements CategorizeQueries {
  constructor(private readonly c: PoolClient) {}

  async activeRules(): Promise<Rule[]> {
    const { rows } = await this.c.query<RuleRow>(
      `select id, match_field, match_type, pattern, amount_min, amount_max,
              set_category_id, set_merchant_id
         from rules
        where is_active
        order by priority`,
    );
    return rows.map((r) => ({
      id: r.id,
      matchField: r.match_field,
      matchType: r.match_type,
      pattern: r.pattern,
      amountMin: r.amount_min === null ? null : new Decimal(r.amount_min),
      amountMax: r.amount_max === null ? null : new Decimal(r.amount_max),
      setCategoryId: r.set_category_id,
      setMerchantId: r.set_merchant_id,
    }));
  }

  /**
   * ชื่อร้านในสเตทเมนต์ไทยมักเพี้ยน ('7-ELEVEN 12345', 'CPALL', 'BIGC 0231')
   * จึงเทียบแบบ "text มี alias อยู่ข้างใน" ไม่ใช่เท่ากันเป๊ะ
   */
  async merchantCategoryByAlias(text: string): Promise<string | null> {
    const { rows } = await this.c.query<{ default_category_id: string | null }>(
      `select default_category_id
         from merchants
        where default_category_id is not null
          and (
            exists (select 1 from unnest(aliases) as a where $1 ilike '%' || a || '%')
            or $1 ilike '%' || canonical_name || '%'
          )
        limit 1`,
      [text],
    );
    return rows[0]?.default_category_id ?? null;
  }
}
