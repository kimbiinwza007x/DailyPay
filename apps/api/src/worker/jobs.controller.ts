import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { loadEnv } from '../config/env';
import { JobRunner } from './job-runner';

/**
 * ทางเข้าให้คิวทำงานเมื่อไม่มี worker ค้างอยู่ (Vercel)
 *
 *  - POST /api/jobs/drain  : ปุ่ม "ประมวลผลตอนนี้" บนหน้าเว็บ ต้องล็อกอิน
 *  - GET  /api/cron/drain  : Vercel Cron เรียกวันละครั้งเป็นตาข่ายสุดท้าย
 *                             ป้องกันด้วย CRON_SECRET (Vercel แนบมาให้เองใน Authorization)
 */
@Controller()
export class JobsController {
  constructor(private readonly runner: JobRunner) {}

  @Post('jobs/drain')
  @HttpCode(200)
  @UseGuards(SupabaseAuthGuard)
  async drain(): Promise<{ processed: number }> {
    return { processed: await this.runner.drain() };
  }

  @Get('cron/drain')
  async cron(@Headers('authorization') authorization?: string): Promise<{ processed: number }> {
    const secret = loadEnv().CRON_SECRET;
    // ไม่ได้ตั้ง CRON_SECRET = ปิด endpoint นี้ไปเลย ดีกว่าเปิดให้ใครก็ยิงได้
    if (!secret || authorization !== `Bearer ${secret}`) {
      throw new UnauthorizedException('cron secret ไม่ถูกต้อง');
    }
    return { processed: await this.runner.drain() };
  }
}
