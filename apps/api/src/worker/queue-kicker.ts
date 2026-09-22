/**
 * "สะกิด" คิวให้ทำงานทันทีหลัง enqueue — ทดแทน worker ที่รันค้างตลอด
 *
 * บน Vercel ไม่มี process ที่อยู่ค้าง และ cron บน Hobby รันได้วันละครั้ง
 * จึงให้ request ที่เพิ่ง enqueue งานเป็นคนรันงานนั้นเองหลังตอบผู้ใช้ไปแล้ว
 * (waitUntil ของ Vercel ให้ function ทำงานต่อหลังส่ง response ได้ถึง maxDuration)
 *
 * ตาราง jobs ยังเป็นแหล่งความจริงเหมือนเดิม — enqueue ยังอยู่ใน transaction เดียวกับ
 * insert batch (design.md ข้อ 7) ตัวนี้แค่เร่งให้งานถูกหยิบเร็วขึ้น ถ้า kick หาย
 * งานก็ยังรออยู่ในคิวให้ cron / ปุ่ม "ประมวลผลตอนนี้" / worker บนเครื่องหยิบไปทำ
 *
 * แยกเป็น service ที่ไม่มี dependency เลย แล้วให้ JobRunner มาลงทะเบียนตัวเองทีหลัง
 * เพราะ ImportService ↔ JobRunner อ้างกันเป็นวง ถ้าฉีดตรง ๆ Nest จะ resolve ไม่ได้
 */
import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { waitUntil } from '@vercel/functions';

type Drain = () => Promise<number>;

@Injectable()
export class QueueKicker {
  private readonly log = new Logger(QueueKicker.name);
  private drain: Drain | null = null;

  register(drain: Drain): void {
    this.drain = drain;
  }

  /** เริ่มรันคิวเบื้องหลัง ไม่รอให้เสร็จ — ผู้เรียกตอบผู้ใช้ต่อได้เลย */
  kick(reason: string): void {
    if (!this.drain) {
      // process นี้ไม่ได้โหลด WorkerModule — งานยังอยู่ในคิวรอ worker ตัวอื่นหยิบ
      return;
    }
    const work = this.drain()
      .then((n) => {
        if (n > 0) this.log.log(`${reason}: ทำงานในคิวเสร็จ ${n} ชิ้น`);
      })
      .catch((err) => this.log.error(`${reason}: รันคิวไม่สำเร็จ ${String(err)}`));

    if (process.env['VERCEL']) {
      // ไม่ห่อ waitUntil = Vercel หยุด function ทันทีที่ส่ง response งานจะค้างกลางทาง
      // ต้องเรียกแบบ synchronous ระหว่าง request ยังไม่จบ (import แบบ async แล้วค่อยเรียก
      // อาจช้ากว่าที่ response ถูกส่งไป)
      waitUntil(work);
    }
  }
}

@Global()
@Module({
  providers: [QueueKicker],
  exports: [QueueKicker],
})
export class QueueKickerModule {}
