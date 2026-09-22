/**
 * จัดหมวด: rules → merchants → LLM (fallback) ไล่จากถูกไปแพง เจอแล้วหยุด
 * pure function เช่นกัน — รับ query interface + llm client เข้ามาเป็น argument
 */
import Decimal from 'decimal.js';
import type { MatchField, MatchType } from '@dailypay/shared';
import type { ParsedRow } from './models';

export interface Rule {
  id: string;
  matchField: MatchField;
  matchType: MatchType;
  pattern: string;
  amountMin: Decimal | null;
  amountMax: Decimal | null;
  setCategoryId: string | null;
  setMerchantId: string | null;
}

export interface CategorizeQueries {
  /** กฎที่ is_active = true เรียงตาม priority (น้อย = สำคัญกว่า) แล้ว */
  activeRules(): Promise<Rule[]>;
  /** หา default_category_id ของ merchant ที่ alias ตรง/พ้องกับ text */
  merchantCategoryByAlias(text: string): Promise<string | null>;
}

export interface LLMClassifier {
  /** คืน category_id ที่ LLM เสนอ หรือ null ถ้าไม่มั่นใจ */
  classify(row: ParsedRow): Promise<string | null>;
}

function fieldValue(row: ParsedRow, field: MatchField): string {
  if (field === 'description_raw') return row.descriptionRaw ?? '';
  if (field === 'counterparty') return row.counterparty ?? '';
  return row.amount.toString();
}

function ruleMatches(rule: Rule, row: ParsedRow): boolean {
  if (rule.matchType === 'amount_range') {
    const lo = rule.amountMin ?? new Decimal('-999999999');
    const hi = rule.amountMax ?? new Decimal('999999999');
    return row.amount.gte(lo) && row.amount.lte(hi);
  }

  const value = fieldValue(row, rule.matchField);
  if (rule.matchType === 'contains') {
    return value.toLowerCase().includes(rule.pattern.toLowerCase());
  }
  if (rule.matchType === 'exact') {
    return value.toLowerCase() === rule.pattern.toLowerCase();
  }
  if (rule.matchType === 'regex') {
    try {
      return new RegExp(rule.pattern, 'i').test(value);
    } catch {
      // regex ที่ผู้ใช้ตั้งเองพังได้ ห้ามทำให้ทั้ง batch ล้ม
      return false;
    }
  }
  return false;
}

export async function suggest(
  row: ParsedRow,
  q: CategorizeQueries,
  llm: LLMClassifier | null = null,
): Promise<string | null> {
  for (const rule of await q.activeRules()) {
    if (rule.setCategoryId && ruleMatches(rule, row)) return rule.setCategoryId;
  }

  if (row.counterparty) {
    const hit = await q.merchantCategoryByAlias(row.counterparty);
    if (hit) return hit;
  }
  if (row.descriptionRaw) {
    const hit = await q.merchantCategoryByAlias(row.descriptionRaw);
    if (hit) return hit;
  }

  // LLM แพงที่สุด เรียกเฉพาะร้านที่ไม่เคยเจอ แล้ว cache ผลลง merchants ถาวร
  if (llm) return llm.classify(row);
  return null;
}
