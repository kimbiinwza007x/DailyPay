import { Controller, Get } from '@nestjs/common';
import { Db } from './db/pool';

@Controller('health')
export class HealthController {
  constructor(private readonly db: Db) {}

  @Get()
  async check(): Promise<{ status: string; db: boolean; error?: string }> {
    try {
      await this.db.query('select 1');
      return { status: 'ok', db: true };
    } catch (err) {
      // บอกไปเลยว่าต่อ DB ไม่ติดเพราะอะไร ไม่งั้นต้องไปไล่อ่าน log เอง
      return {
        status: 'degraded',
        db: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
