/**
 * อ่าน QR จากสลิปธนาคาร
 * ใช้ zxing-wasm (= zxing-cpp ตัวเดียวกับที่ design.md เลือก คอมไพล์เป็น WASM)
 * เพราะได้ผลดีกับ QR เล็กและหนาแน่นแบบบนสลิป
 *
 * สลิปที่ save ตรงจากแอปเป็นภาพ render ใหม่ ไม่ผ่านการบีบอัดซ้ำ อ่านออกแทบทุกใบ
 * ยังต้องมีสาย unreadable เผื่อสลิปที่ส่งต่อทาง LINE (บีบอัดรูปทุกใบ) คาดว่า 2-3%
 *
 * ทุก import เป็น dynamic + ห่อ try/catch: เครื่องที่ยังไม่ได้ลง sharp/zxing ต้องยังรันได้
 * แค่ได้ qr_status = 'unreadable' ทุกใบ
 */
import { Logger } from '@nestjs/common';
import { renderPdfFirstPage } from '../core/parsers/pdf-text';

const log = new Logger('QrReader');

interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

async function decodeToRgba(
  image: Buffer,
  transform?: (s: import('sharp').Sharp) => import('sharp').Sharp,
): Promise<RgbaImage | null> {
  try {
    const sharp = (await import('sharp')).default;
    let pipeline = sharp(image, { failOn: 'none' });
    if (transform) pipeline = transform(pipeline);
    const { data, info } = await pipeline
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return {
      data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
      width: info.width,
      height: info.height,
    };
  } catch (err) {
    log.debug(`decode ภาพไม่สำเร็จ: ${String(err)}`);
    return null;
  }
}

async function readOne(img: RgbaImage): Promise<string | null> {
  try {
    const { readBarcodes } = await import('zxing-wasm/reader');
    const results = await readBarcodes(img, {
      formats: ['QRCode'],
      tryHarder: true,
      maxNumberOfSymbols: 1,
    });
    const hit = results.find((r) => r.isValid && r.text);
    return hit?.text ?? null;
  } catch (err) {
    log.debug(`zxing อ่านไม่สำเร็จ: ${String(err)}`);
    return null;
  }
}

export async function readSlipQr(data: Buffer): Promise<string | null> {
  const full = await decodeToRgba(data, (s) => s.grayscale());
  if (!full) return null;

  const first = await readOne(full);
  if (first) return first;

  // เผื่อใบที่หลุด: crop ครึ่งล่าง (QR มักอยู่ล่างสุดของสลิป) ขยาย 2 เท่า ลองอีกรอบเดียว
  return readSlipQrCropped(data);
}

/** crop ครึ่งล่างแล้วขยาย 2 เท่า — แยกออกมาเพราะต้องรู้ขนาดภาพก่อนถึงจะ extract ได้ */
async function readSlipQrCropped(data: Buffer): Promise<string | null> {
  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(data, { failOn: 'none' }).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width === 0 || height === 0) return null;

    const top = Math.floor(height * 0.5);
    const cropped = await decodeToRgba(data, (s) =>
      s
        .grayscale()
        .extract({ left: 0, top, width, height: height - top })
        .resize({ width: width * 2, kernel: 'cubic' }),
    );
    return cropped ? readOne(cropped) : null;
  } catch (err) {
    log.debug(`crop-retry ไม่สำเร็จ: ${String(err)}`);
    return null;
  }
}

/** สลิปที่เป็น PDF ต้อง render ที่ 300dpi ก่อนเสมอ อย่าอ่านจากภาพตัวอย่าง */
export async function readSlipQrFromPdf(pdfBytes: Buffer, dpi = 300): Promise<string | null> {
  const png = await renderPdfFirstPage(pdfBytes, dpi);
  return png ? readSlipQr(png) : null;
}

/** ตัวเดียวที่ชั้นบนเรียก: เลือกสายตามชนิดไฟล์ให้เอง */
export async function readSlipQrAuto(raw: Buffer): Promise<string | null> {
  if (raw.subarray(0, 4).toString('latin1') === '%PDF') return readSlipQrFromPdf(raw);
  return readSlipQr(raw);
}
