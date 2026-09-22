/**
 * Parser สำหรับไฟล์ CSV export จาก K PLUS / KBank statement
 *
 * TODO (ยกมาจาก design.md ข้อ 11): dump payload ของไฟล์จริงออกมาดูก่อน อย่าเชื่อ mapping นี้
 * ตอนนี้เขียนตามรูปแบบคอลัมน์ที่พบได้บ่อยที่สุด (วันที่, เวลา, รายการ, ถอน, ฝาก, คงเหลือ,
 * ช่องทาง/หมายเหตุ, เลขที่รายการ) — ต้อง validate กับไฟล์จริงก่อนใช้งานจริง
 */
import { parse } from 'csv-parse/sync';
import Decimal from 'decimal.js';
import type { BatchSource } from '@dailypay/shared';
import { makeParsedRow, type ParsedRow } from '../models';
import {
  bangkokDateTime,
  type Parser,
  parseThaiDate,
  toDecimal,
  todayInBangkok,
} from './base';

const EXPECTED_HEADERS = ['วันที่', 'รายการ', 'ถอน', 'ฝาก', 'คงเหลือ'];

export class KBankCsv implements Parser {
  readonly name = 'kbank_csv';
  readonly source: BatchSource = 'csv';

  async sniff(raw: Buffer, filename: string): Promise<number> {
    let score = 0;
    if (filename.toLowerCase().endsWith('.csv')) score += 0.2;

    const text = raw.subarray(0, 4096).toString('utf8');
    const headerHits = EXPECTED_HEADERS.filter((h) => text.includes(h)).length;
    score += 0.6 * (headerHits / EXPECTED_HEADERS.length);

    const lower = text.toLowerCase();
    if (text.includes('กสิกร') || lower.includes('kbank') || lower.includes('k plus')) {
      score += 0.2;
    }
    return Math.min(score, 1.0);
  }

  async *rows(raw: Buffer): AsyncIterable<ParsedRow> {
    // ลบ BOM ถ้ามี (Excel ฝั่งไทย export มาพร้อม BOM เกือบทุกครั้ง)
    let text = raw.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

    let records: Record<string, string>[];
    try {
      records = parse(text, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        bom: true,
      }) as Record<string, string>[];
    } catch {
      // ไฟล์พังทั้งไฟล์ (ไม่ใช่ CSV จริง) — คืนศูนย์แถว ให้ batch ไปจบที่ review ว่างเปล่า
      return;
    }

    for (const line of records) {
      const payload: Record<string, unknown> = { ...line };
      const booked = parseThaiDate(line['วันที่'] ?? '');
      const withdraw = toDecimal(line['ถอน']);
      const deposit = toDecimal(line['ฝาก']);
      const balance = toDecimal(line['คงเหลือ']);
      const desc = (line['รายการ'] ?? '').trim() || null;
      const ref = (line['เลขที่รายการ'] ?? line['ref'] ?? '').trim() || null;
      const timeText = (line['เวลา'] ?? '').trim() || null;

      if (booked === null || (withdraw === null && deposit === null)) {
        yield makeParsedRow({
          bookedDate: booked ?? todayInBangkok(),
          amount: new Decimal(0),
          descriptionRaw: desc,
          bankRef: ref,
          confidence: 0,
          payload,
        });
        continue;
      }

      // signed amount: ถอน = ติดลบ, ฝาก = บวก (ห้ามแยกเป็น direction + ยอดบวก)
      const amount = withdraw && !withdraw.isZero() ? withdraw.neg() : (deposit ?? new Decimal(0));

      yield makeParsedRow({
        bookedDate: booked,
        amount,
        occurredAt: bangkokDateTime(booked, timeText),
        descriptionRaw: desc,
        bankRef: ref,
        balanceAfter: balance,
        confidence: 1.0,
        payload,
      });
    }
  }
}
