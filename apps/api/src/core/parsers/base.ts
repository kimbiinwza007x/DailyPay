/** สัญญาที่ทุก parser ต้องทำตาม + helper วันที่/จำนวนเงินแบบไทยที่ใช้ร่วมกัน */
import Decimal from 'decimal.js';
import type { BatchSource } from '@dailypay/shared';
import type { ParsedRow } from '../models';

export class NoParserMatched extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoParserMatched';
  }
}

export interface Parser {
  readonly name: string;
  readonly source: BatchSource;

  /** คืน 0.0-1.0 ว่าไฟล์นี้เป็นของ parser ตัวนี้แค่ไหน */
  sniff(raw: Buffer, filename: string): Promise<number>;

  /**
   * แปลงทั้งไฟล์ ห้าม throw กลางทาง — แถวที่พังให้ confidence = 0
   * ถ้าไฟล์ 200 แถวพังที่แถว 137 แล้วโยน exception ผู้ใช้จะไม่ได้อะไรเลย
   */
  rows(raw: Buffer): AsyncIterable<ParsedRow>;
}

export const THAI_MONTHS: Record<string, number> = {
  'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6,
  'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
};

export const MAX_FUTURE_YEAR_SLACK = 1;

/** 'YYYY-MM-DD' ตามเวลาไทย ไม่ใช่ ISO ของ Date (กัน UTC เลื่อนข้ามวัน) */
export function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // ตรวจว่ามีวันนี้จริง (31 ก.พ. ต้องตก)
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

export function todayInBangkok(): string {
  // en-CA ให้รูปแบบ YYYY-MM-DD พอดี
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
}

export function currentYearInBangkok(): number {
  return Number(todayInBangkok().slice(0, 4));
}

/**
 * แปลง '12 ก.ย. 2568' (พ.ศ.) เป็น '2025-09-12'
 * ถ้าปีที่ได้เกินปีปัจจุบัน + 1 ให้ถือว่า parse ผิดทันที (design.md ข้อ 8)
 */
export function parseThaiDate(text: string): string | null {
  const parts = text.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const [dayS, monthS, yearS] = parts as [string, string, string];
  const month = THAI_MONTHS[monthS];
  if (month === undefined) return null;
  const day = Number(dayS);
  const yearBe = Number(yearS);
  if (!Number.isInteger(day) || !Number.isInteger(yearBe)) return null;
  const yearCe = yearBe - 543;
  if (yearCe > currentYearInBangkok() + MAX_FUTURE_YEAR_SLACK) return null;
  return toIsoDate(yearCe, month, day);
}

export function toDecimal(text: string | null | undefined): Decimal | null {
  const cleaned = (text ?? '').replaceAll(',', '').replaceAll('฿', '').trim();
  if (cleaned === '') return null;
  try {
    const d = new Decimal(cleaned);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/** ประกอบ occurred_at จากวันที่ไทย + 'HH:MM' ให้เป็น instant ที่ถูกต้อง (UTC+7) */
export function bangkokDateTime(bookedDate: string, timeText: string | null): Date | null {
  if (!timeText) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(timeText.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  const iso = `${bookedDate}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+07:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
