/**
 * Parser สำหรับ statement PDF ของ SCB (SCB EASY / เคาน์เตอร์สาขา)
 *
 * TODO (ยกมาจาก design.md ข้อ 11): เขียนจาก spec ที่หาได้ในเน็ต ยังไม่เคยทดสอบกับไฟล์จริง
 * ต้อง dump payload ของ PDF จริงมาดูก่อนใช้งาน — โครงตารางของแต่ละธนาคารเปลี่ยนได้ตลอด
 */
import Decimal from 'decimal.js';
import type { BatchSource } from '@dailypay/shared';
import { makeParsedRow, type ParsedRow } from '../models';
import {
  bangkokDateTime,
  currentYearInBangkok,
  type Parser,
  toDecimal,
  toIsoDate,
  todayInBangkok,
} from './base';
import { extractPdfText } from './pdf-text';

// แถวทั่วไปในสเตทเมนต์ SCB: "12/09/25  14:30  รายละเอียด...  1,250.00  50,000.00"
const ROW_RE =
  /(?<date>\d{2}\/\d{2}\/\d{2,4})\s+(?<time>\d{2}:\d{2})?\s*(?<desc>.*?)\s+(?<amount>-?[\d,]+\.\d{2})\s+(?<balance>[\d,]+\.\d{2})\s*$/;

/** ปีสองหลักบนสเตทเมนต์ไทยมักเป็น พ.ศ. (25 → 2568 → 2025) */
function parseSlashDate(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{2,4})$/.exec(text);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);

  if (m[3]!.length === 2) {
    // 2 หลัก: ตีความเป็น พ.ศ. ย่อก่อน (25 → 2568) แล้วค่อยลบ 543
    year = 2500 + year;
  }
  if (year > 2400) year -= 543;
  if (year > currentYearInBangkok() + 1) return null;
  return toIsoDate(year, month, day);
}

export class ScbStatementPdf implements Parser {
  readonly name = 'scb_statement_pdf';
  readonly source: BatchSource = 'statement_pdf';

  async sniff(raw: Buffer, filename: string): Promise<number> {
    let score = 0;
    if (filename.toLowerCase().endsWith('.pdf')) score += 0.2;
    if (raw.subarray(0, 4).toString('latin1') === '%PDF') score += 0.1;

    const text = await extractPdfText(raw);
    if (text.includes('ไทยพาณิชย์') || text.includes('SCB') || text.includes('Siam Commercial')) {
      score += 0.5;
    }
    if (text.split('\n').some((line) => ROW_RE.test(line.trim()))) score += 0.2;
    return Math.min(score, 1.0);
  }

  async *rows(raw: Buffer): AsyncIterable<ParsedRow> {
    const text = await extractPdfText(raw);
    const lines = text.split('\n');

    for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
      const line = lines[lineNo]!.trim();
      const m = ROW_RE.exec(line);
      if (!m?.groups) continue;

      const payload: Record<string, unknown> = { line_no: lineNo, raw_line: line };
      const booked = parseSlashDate(m.groups['date']!);
      const amount = toDecimal(m.groups['amount']);
      const balance = toDecimal(m.groups['balance']);
      const desc = (m.groups['desc'] ?? '').trim() || null;

      if (booked === null || amount === null) {
        yield makeParsedRow({
          bookedDate: booked ?? todayInBangkok(),
          amount: new Decimal(0),
          descriptionRaw: desc,
          confidence: 0,
          payload,
        });
        continue;
      }

      yield makeParsedRow({
        bookedDate: booked,
        amount,
        occurredAt: bangkokDateTime(booked, m.groups['time'] ?? null),
        descriptionRaw: desc,
        balanceAfter: balance,
        confidence: 0.9,
        payload,
      });
    }
  }
}
