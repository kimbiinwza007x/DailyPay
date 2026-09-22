import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { loadEnv } from './config/env';

/**
 * 500 เปล่า ๆ ทำให้ไล่หาสาเหตุไม่ได้เลย — log ของจริงเสมอ
 * และตอน dev ส่งข้อความจริงกลับไปด้วย (production ไม่ส่ง กันข้อมูล DB รั่วออกทาง error)
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Exception');
  private readonly isDev = loadEnv().NODE_ENV !== 'production';

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) this.log.error(`${req.method} ${req.url}`, exception.stack);
      res.status(status).json(exception.getResponse());
      return;
    }

    const err = exception instanceof Error ? exception : new Error(String(exception));
    this.log.error(`${req.method} ${req.url} — ${err.message}`, err.stack);

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: this.isDev ? err.message : 'Internal server error',
      ...(this.isDev && this.hint(err) ? { hint: this.hint(err) } : {}),
    });
  }

  /** แปล error ที่เจอบ่อยให้เป็นภาษาที่บอกได้ว่าต้องไปแก้ตรงไหน */
  private hint(err: Error): string | null {
    // ข้อความจาก pooler ของ Supabase ใส่ code ไว้ในตัวข้อความ ไม่ใช่ใน err.code
    // จึงต้องดูทั้งสองที่ ไม่งั้น hint ไม่เคยทำงาน
    const m = (err.message + ' ' + ((err as NodeJS.ErrnoException).code ?? '')).toLowerCase();

    if (m.includes('tenant') && m.includes('not found')) {
      return 'username ใน DATABASE_URL ยังไม่ถูก — ต้องเป็น postgres.<project-ref> ของโปรเจกต์คุณ ' +
        'คัดลอก connection string (URI, Session pooler พอร์ต 5432) จาก Dashboard → Settings → Database มาใหม่';
    }
    if (m.includes('password authentication failed') || m.includes('sasl')) {
      return 'รหัสผ่านฐานข้อมูลไม่ถูก — แทน [YOUR-PASSWORD] ใน connection string ด้วยรหัสจริง ' +
        '(รีเซ็ตได้ที่ Dashboard → Settings → Database → Database password)';
    }
    if (m.includes('enotfound') || m.includes('eai_again')) {
      return 'หา host ของฐานข้อมูลไม่เจอ — DATABASE_URL ใน .env ยังเป็นค่าตัวอย่างหรือพิมพ์ผิด';
    }
    if (m.includes('econnrefused') || m.includes('etimedout')) {
      return 'ต่อฐานข้อมูลไม่ติด — เช็ค host/port (ต้องเป็น session pooler พอร์ต 5432 ไม่ใช่ 6543)';
    }
    if (m.includes('does not exist') && (m.includes('relation') || m.includes('table'))) {
      return 'ยังไม่มีตารางในฐานข้อมูล — รัน supabase/setup.sql ใน SQL Editor ก่อน';
    }
    return null;
  }
}
