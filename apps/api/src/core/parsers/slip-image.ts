/**
 * Parser สำหรับสลิปโอนเงิน (รูปภาพ / PDF หน้าเดียว)
 *
 * บรรทัดที่สำคัญที่สุดของทั้งระบบ (design.md ข้อ 5): เอา qr_payload ไปใส่ bank_ref ด้วย
 * ทำให้ fingerprint ของรายการจากสลิปชนกับรายการเดียวกันจากไฟล์ statement โดยอัตโนมัติ
 * ไม่ต้องเขียนโค้ดจับคู่ข้ามแหล่งเพิ่มเลย
 *
 * core ห้าม import adapters — ตัวอ่าน QR/OCR จริงถูกฉีดเข้ามาเป็น callable ตอนสร้าง instance
 * ทำให้เทสไฟล์นี้ได้ด้วย fake reader โดยไม่ต้องมี sharp/zxing/tesseract ติดตั้งจริง
 */
import Decimal from 'decimal.js';
import type { BatchSource } from '@dailypay/shared';
import { makeParsedRow, type ParsedRow } from '../models';
import { type Parser, todayInBangkok } from './base';

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function looksLikeImage(raw: Buffer): boolean {
  return raw.subarray(0, 3).equals(JPEG_MAGIC) || raw.subarray(0, 8).equals(PNG_MAGIC);
}

function looksLikePdf(raw: Buffer): boolean {
  return raw.subarray(0, 4).toString('latin1') === '%PDF';
}

export interface SlipOcrResult {
  rawText: string;
  amount: Decimal | null;
  receiverName: string | null;
  receiverLast4: string | null;
  slipDate: string | null;
}

export type QrReader = (raw: Buffer) => Promise<string | null>;
export type OcrReader = (raw: Buffer) => Promise<SlipOcrResult | null>;

export class SlipImage implements Parser {
  readonly name = 'slip_image';
  readonly source: BatchSource = 'slip_image';

  private readonly qrReader: QrReader;
  private readonly ocrReader: OcrReader;

  constructor(qrReader?: QrReader, ocrReader?: OcrReader) {
    // ค่าเริ่มต้นเป็น no-op เพื่อให้สร้าง SlipImage() เปล่า ๆ ได้ (sniff ทำงานได้)
    // ของจริงต้องฉีด reader เข้ามาจากชั้น module
    this.qrReader = qrReader ?? (async () => null);
    this.ocrReader = ocrReader ?? (async () => null);
  }

  async sniff(raw: Buffer, filename: string): Promise<number> {
    const name = filename.toLowerCase();
    if (/\.(jpg|jpeg|png)$/.test(name) && looksLikeImage(raw)) return 0.9;
    if (name.endsWith('.pdf') && looksLikePdf(raw)) {
      // เดายาก ต้อง render ก่อนถึงจะรู้ว่าเป็นสลิปหรือ statement หลายหน้า
      return 0.3;
    }
    return 0.0;
  }

  async *rows(raw: Buffer): AsyncIterable<ParsedRow> {
    let qrPayload: string | null = null;
    try {
      qrPayload = await this.qrReader(raw);
    } catch {
      qrPayload = null;
    }

    let ocr: SlipOcrResult | null = null;
    try {
      ocr = await this.ocrReader(raw);
    } catch {
      ocr = null;
    }

    const payload: Record<string, unknown> = {
      qr_status: qrPayload ? 'found' : 'unreadable',
    };
    if (ocr) {
      payload['ocr_text'] = ocr.rawText;
      payload['receiver_name'] = ocr.receiverName;
      payload['receiver_last4'] = ocr.receiverLast4;
      payload['ocr_amount'] = ocr.amount ? ocr.amount.toFixed(2) : null;
      payload['ocr_date'] = ocr.slipDate;
    }
    if (qrPayload) payload['qr_payload'] = qrPayload;

    const amount = ocr?.amount ?? null;
    // ไม่มี QR = ไม่มั่นใจพอ ต้องเข้าคิว review เสมอ (สลิปที่ถูก LINE บีบอัด)
    const confidence = amount !== null ? 1.0 : qrPayload ? 0.6 : 0.0;

    yield makeParsedRow({
      // ถ้า OCR อ่านวันที่ได้ใช้ของ OCR ไม่งั้นใช้วันนี้ แล้วให้ผู้ใช้ยืนยันในหน้าตรวจ
      bookedDate: ocr?.slipDate ?? todayInBangkok(),
      // สลิปโอนออกเสมอ: ติดลบ
      amount: amount !== null ? amount.abs().neg() : new Decimal(0),
      descriptionRaw: ocr?.receiverName ?? null,
      counterparty: ocr?.receiverName ?? null,
      bankRef: qrPayload, // << จุดที่ทำให้ชนกับ statement อัตโนมัติ
      confidence,
      payload,
    });
  }
}
