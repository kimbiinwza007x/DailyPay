/**
 * Object storage สำหรับไฟล์ต้นฉบับ/สลิป — อย่าเก็บเป็น bytea ใน DB (design.md ข้อ 8)
 * รูปสลิปใบละ 200KB สะสมเป็นพันใบทำให้ backup ช้าลงสิบเท่าโดยไม่ได้ประโยชน์
 */
export interface ObjectStore {
  /** เขียนไฟล์ คืน uri ที่ใช้เก็บลง DB (import_batches.file_uri) */
  put(key: string, data: Buffer, contentType?: string): Promise<string>;
  /** อ่านไฟล์กลับมาเป็น Buffer จาก uri ที่ได้จาก put() */
  get(uri: string): Promise<Buffer>;
  /** ลิงก์ชั่วคราวให้ browser โหลดไฟล์ดูเองได้ โดยไม่ต้องผ่าน Nest */
  signedUrl(uri: string, expiresInSeconds?: number): Promise<string | null>;
}

export const OBJECT_STORE = Symbol('OBJECT_STORE');
