/**
 * worker แบบรันค้าง — ใช้บนเครื่องตัวเองหรือเซิร์ฟเวอร์ที่รัน process ยาวได้
 *
 * บน Vercel ไม่มีตัวนี้ API ทำงานในคิวเองหลังอัปโหลด (ดู worker/queue-kicker.ts)
 * บนเครื่องตัวเองก็ไม่จำเป็นแล้วด้วยเหตุผลเดียวกัน แต่ยังมีประโยชน์ไว้เก็บงานที่ค้าง/ล้มเหลว
 * ซึ่งถูกเลื่อนเวลาไว้ (backoff) — รันคู่กับ API ได้ for update skip locked กันแย่งงานกัน
 */
import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from './config/env';
import { DbModule } from './db/db.module';
import { ParsersModule } from './parsers.module';
import { StorageModule } from './storage/storage.module';
import { WorkerModule } from './worker/worker.module';
import { JobRunner } from './worker/job-runner';
import { QueueKickerModule } from './worker/queue-kicker';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env', '../../.env'] }),
    DbModule,
    StorageModule,
    ParsersModule,
    QueueKickerModule,
    WorkerModule,
  ],
})
class WorkerAppModule {}

async function bootstrap(): Promise<void> {
  loadDotenv({ path: ['.env.local', '.env', '../../.env'] });
  const env = loadEnv();

  const app = await NestFactory.createApplicationContext(WorkerAppModule);
  app.enableShutdownHooks();
  const runner = app.get(JobRunner);

  const shutdown = (signal: string): void => {
    new Logger('worker').log(`ได้รับ ${signal} — หยุดหลังงานปัจจุบันจบ`);
    runner.stop();
    void app.close().then(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await runner.runForever(env.WORKER_POLL_INTERVAL_MS);
}

void bootstrap();
