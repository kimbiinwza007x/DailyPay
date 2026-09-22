/**
 * OCR สำรองสำหรับสลิปที่อ่าน QR ไม่ออก และใช้ดึงยอด/วันที่มาเสนอในหน้าตรวจ
 * ไม่ใช้เป็นตัวกันซ้ำหลัก (design.md ข้อ 5 — OCR ไม่นิ่งพอจะเอามาคำนวณ fingerprint)
 *
 * ปรับจากการวัดกับสลิปจริง 4 ใบ (K PLUS, MAKE by KBank, Dime!, TrueMoney):
 *
 *  - ยอดตัวใหญ่บนหัวสลิป tesseract โหมดปกติ "มองข้ามทั้งบรรทัด" (Dime! 240.49, TrueMoney ฿99.00)
 *    แก้ด้วยการขยายภาพ 2 เท่า + normalise ก่อนส่งเข้า OCR แล้วถ้ายังไม่เจอยอดค่อยยิงซ้ำด้วย
 *    psm 11 (sparse text) ซึ่งจับข้อความลอย ๆ ได้ดีกว่า
 *
 *  - ค่าธรรมเนียมอยู่ในรูปแบบ "<เลข> บาท" เหมือนกับยอดจริงเป๊ะ ถ้าหยิบผิดจะบันทึกรายการ
 *    240.49 เป็น 0.00 แบบเงียบ ๆ ซึ่งแย่กว่าอ่านไม่ได้ จึงต้องตัดบรรทัดค่าธรรมเนียมทิ้งก่อนเสมอ
 *
 *  - ชื่อเดือนไทยถูกอ่านเพี้ยนแทบทุกใบ ('ก.ย.' → 'ณย.', 'กุย.') จึงเทียบแบบถอดสระ/วรรณยุกต์
 *    ออกก่อน ถ้ายังไม่ตรงค่อยลองตารางตัวสะกดที่เคยเจอจริง — เดาไม่ออกคืน null ไม่เดามั่ว
 */
import { Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { toIsoDate, currentYearInBangkok, MAX_FUTURE_YEAR_SLACK } from '../core/parsers/base';
import type { SlipOcrResult } from '../core/parsers/slip-image';
import { renderPdfFirstPage } from '../core/parsers/pdf-text';

const log = new Logger('ThaiOcr');

/** สระบน/ล่าง + วรรณยุกต์ ที่ OCR มักใส่เกินหรือตกหล่น ตัดทิ้งก่อนเทียบชื่อเดือน */
const THAI_DIACRITICS = /[ัิ-ฺ็-๎]/g;

// ถอดสระ/วรรณยุกต์แล้วเหลือแต่พยัญชนะ — 'มี.ค.' กับ 'ม.ค.' เหลือ 'มค' เหมือนกัน
// จึงต้องให้ MONTH_EXACT ตัดสินก่อน ตารางนี้เป็นด่านรอง
const MONTH_BY_CONSONANTS: Record<string, number> = {
  มค: 1, กพ: 2, เมย: 4, พค: 5, มย: 6,
  กค: 7, สค: 8, กย: 9, ตค: 10, พย: 11, ธค: 12,
};

/** 'มี.ค.' ถอดสระแล้วชนกับ 'ม.ค.' จึงต้องดูตัวเต็มก่อนถอด */
const MONTH_EXACT: Record<string, number> = {
  'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6,
  'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
  มีค: 3, มิย: 6,
};

/**
 * ตัวสะกดผิดที่ "เจอจริง" จากสลิปที่ทดสอบ ไม่ใช่การเดาแบบกว้าง ๆ
 * เพิ่มเข้ามาได้เมื่อเจอใบใหม่ที่อ่านเพี้ยนแบบอื่น
 */
const MONTH_OCR_ALIASES: Record<string, number> = {
  ณย: 9, // K PLUS: 'ก.ย.' → 'ณย.'
  ณค: 7, // ตามรูปแบบเดียวกัน ก→ณ
  ฌย: 9,
};

function monthFromToken(token: string): number | null {
  const raw = token.trim();
  if (MONTH_EXACT[raw] !== undefined) return MONTH_EXACT[raw]!;

  const stripped = raw.replace(/[.\s]/g, '');
  if (MONTH_EXACT[stripped] !== undefined) return MONTH_EXACT[stripped]!;

  const consonants = stripped.replace(THAI_DIACRITICS, '');
  if (MONTH_BY_CONSONANTS[consonants] !== undefined) return MONTH_BY_CONSONANTS[consonants]!;
  if (MONTH_OCR_ALIASES[consonants] !== undefined) return MONTH_OCR_ALIASES[consonants]!;
  return null;
}

/** '13 ณย. 69', '07 กุย. 2569 - 22:09', '8 ก.ย. 2569 15:25:35' */
const DATE_RE = /(\b\d{1,2})\s+([฀-๿.]{2,7})\s*(25\d{2}|\d{2})(?!\d)/;

/** ยอดเงิน: '100.00 บาท', '240.49 บาท', '฿ 99.00', '8 99.00' (฿ ถูกอ่านเป็น 8) */
const AMOUNT_ON_LINE = /(?:฿|บาท|THB)?\s*(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})\b/;
const FEE_WORDS = /ค่าธรรมเนียม|ธรรมเนียม|fee/i;
/** คำที่บอกว่าบรรทัดนี้/บรรทัดถัดไปคือยอดจริง */
const AMOUNT_LABEL = /จ.{0,2}นวน|ยอด|จ่าย|โอน|amount|฿/i;

/**
 * เลขบัญชีบนสลิปถูกปิดบังหลายแบบ: 'xxx-x-x9850-x', '***-***-4628', '004-*********-209'
 * จับทั้งก้อนก่อนแล้วค่อยดึงกลุ่มตัวเลข 4 ตัวสุดท้ายออกมา
 */
const MASKED_ACCOUNT_RE = /[x*#][x*#\d\-.\s]{3,}\d/gi;
const RECEIVER_LABEL = /(?:ไปยัง|ถึง|ผู้รับ|รายละเอียด)\s*:?\s*(.*)/;

/** ตัดขยะที่ OCR แปะมาท้ายชื่อ (ไอคอน/ลายน้ำ) ออก */
function cleanName(s: string): string | null {
  const cleaned = s
    .replace(/[[\]{}|©®™]/g, ' ')
    .replace(/\s{2,}.*$/, '') // ช่องว่างยาว = คนละคอลัมน์บนสลิป
    .replace(/[^฀-๿a-zA-Z0-9.\-*# ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 2 ? cleaned.slice(0, 80) : null;
}

function extractAmount(text: string): Decimal | null {
  const lines = text.split('\n');
  const candidates: { value: Decimal; labelled: boolean }[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const prev = lines[i - 1] ?? '';

    // ค่าธรรมเนียมเขียนแบบ '<label>:' บรรทัดหนึ่ง แล้วยอดอยู่บรรทัดถัดไป (K PLUS)
    // จึงต้องดูบรรทัดก่อนหน้าด้วย ไม่ใช่แค่บรรทัดตัวเอง
    if (FEE_WORDS.test(line) || FEE_WORDS.test(prev)) continue;

    const m = AMOUNT_ON_LINE.exec(line);
    if (!m) continue;

    const value = new Decimal(`${m[1]!.replaceAll(',', '')}.${m[2]}`);
    if (value.isZero()) continue; // ยอด 0 ไม่ใช่รายการจริง
    candidates.push({ value, labelled: AMOUNT_LABEL.test(line) || AMOUNT_LABEL.test(prev) });
  }

  if (candidates.length === 0) return null;
  // ยอดที่มีคำกำกับชนะเสมอ ถ้าไม่มีเลยใช้ตัวแรกที่เจอ (สลิปวางยอดจริงไว้บนสุด)
  return (candidates.find((c) => c.labelled) ?? candidates[0]!).value;
}

function extractDate(text: string): string | null {
  const m = DATE_RE.exec(text);
  if (!m) return null;

  const day = Number(m[1]);
  const month = monthFromToken(m[2]!);
  if (month === null) return null;

  let yearBe = Number(m[3]);
  if (m[3]!.length === 2) yearBe += 2500; // '69' → 2569
  const yearCe = yearBe - 543;
  if (yearCe > currentYearInBangkok() + MAX_FUTURE_YEAR_SLACK) return null;
  if (yearCe < 2000) return null;

  return toIsoDate(yearCe, month, day);
}

function extractReceiver(text: string): string | null {
  for (const line of text.split('\n')) {
    const m = RECEIVER_LABEL.exec(line);
    if (!m) continue;
    const name = cleanName(m[1] ?? '');
    if (name) return name;
  }
  return null;
}

/** parse ข้อความ OCR ดิบ — pure function เทสได้โดยไม่ต้องรัน tesseract */
function extractLast4(text: string): string | null {
  for (const match of text.matchAll(MASKED_ACCOUNT_RE)) {
    const digits = /(\d{4})(?!.*\d{4})/.exec(match[0]);
    if (digits) return digits[1]!;
  }
  return null;
}

export function parseSlipText(text: string): SlipOcrResult {
  return {
    rawText: text,
    amount: extractAmount(text),
    receiverName: extractReceiver(text),
    receiverLast4: extractLast4(text),
    slipDate: extractDate(text),
  };
}

/** ขยาย 2 เท่า + ปรับคอนทราสต์ — ถ้าไม่ทำ ยอดตัวใหญ่บนหัวสลิปหายทั้งบรรทัด */
async function preprocess(image: Buffer): Promise<Buffer> {
  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(image).metadata();
    const width = meta.width ?? 800;
    return await sharp(image)
      .grayscale()
      .normalise()
      .resize({ width: Math.min(width * 2, 4000), kernel: 'lanczos3' })
      .png()
      .toBuffer();
  } catch (err) {
    log.debug(`ปรับภาพก่อน OCR ไม่สำเร็จ ใช้ภาพเดิม: ${String(err)}`);
    return image;
  }
}

async function runOcr(image: Buffer, pageSegMode?: string): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const { tmpdir } = await import('node:os');
  // tesseract.js โหลด traineddata จาก CDN แล้ว cache ลงดิสก์ ค่าเริ่มต้นเขียนลงโฟลเดอร์ปัจจุบัน
  // ซึ่งบน Vercel เป็น read-only ทั้งหมดยกเว้น /tmp — ไม่ชี้ไป tmp จะพังตั้งแต่ใบแรก
  const worker = await createWorker('tha+eng', 1, { cachePath: tmpdir() });
  try {
    if (pageSegMode) {
      await worker.setParameters({ tessedit_pageseg_mode: pageSegMode as never });
    }
    const { data } = await worker.recognize(image);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

export async function readSlipText(imageBytes: Buffer): Promise<SlipOcrResult | null> {
  try {
    let input = imageBytes;
    if (imageBytes.subarray(0, 4).toString('latin1') === '%PDF') {
      const png = await renderPdfFirstPage(imageBytes, 300);
      if (!png) return null;
      input = png;
    }

    /**
     * OCR สองรอบให้ผลคนละแบบ และต่างคนต่างเก่งคนละอย่าง (วัดจากสลิปจริง 3 ค่าย):
     *   - ภาพที่ขยาย+ปรับคอนทราสต์ : อ่านยอดตัวใหญ่ได้ แต่ชื่อเดือนไทยเพี้ยนเป็นอักษรละติน
     *     ('ก.ย.' → 'ge', 'n.9.')
     *   - ภาพต้นฉบับ              : ชื่อเดือนยังเป็นไทยอ่านออก แต่ยอดตัวใหญ่หายทั้งบรรทัด
     * จึงยิงรอบแรกด้วยภาพที่ปรับแล้ว ขาดอะไรค่อยยิงรอบต่อไปแล้วเอาข้อความมาต่อกัน
     * ไม่ยิงครบทุกรอบตั้งแต่แรกเพราะ OCR หนึ่งรอบใช้เวลาหลายวินาที
     */
    const prepared = await preprocess(input);
    let text = await runOcr(prepared);
    let result = parseSlipText(text);
    if (result.amount !== null && result.slipDate !== null) return result;

    if (prepared !== input) {
      log.debug('ยิง OCR ซ้ำด้วยภาพต้นฉบับ (เดือนไทยมักอ่านออกจากภาพที่ไม่ได้ปรับ)');
      text = `${text}
${await runOcr(input)}`;
      result = parseSlipText(text);
      if (result.amount !== null) return result;
    }

    log.debug('ยังไม่เจอยอด ลองใหม่ด้วย psm 11 (sparse text)');
    text = `${text}
${await runOcr(prepared, '11')}`;
    return parseSlipText(text);
  } catch (err) {
    log.debug(`OCR ไม่สำเร็จ: ${String(err)}`);
    return null;
  }
}
