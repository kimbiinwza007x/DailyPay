import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from './db/db.module';
import { ParsersModule } from './parsers.module';
import { StorageModule } from './storage/storage.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { ImportModule } from './modules/import/import.module';
import { ReportModule } from './modules/report/report.module';
import { ReviewModule } from './modules/review/review.module';
import { HealthController } from './health.controller';
import { JobsController } from './worker/jobs.controller';
import { QueueKickerModule } from './worker/queue-kicker';
import { WorkerModule } from './worker/worker.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env', '../../.env'] }),
    DbModule,
    StorageModule,
    ParsersModule,
    // API ทำงานในคิวเองได้หลังอัปโหลด/commit (จำเป็นบน Vercel ที่ไม่มี worker ค้าง)
    // บนเครื่องตัวเองยังรัน `pnpm dev:worker` คู่ได้ — for update skip locked กันแย่งงานกัน
    QueueKickerModule,
    WorkerModule,
    ImportModule,
    ReviewModule,
    ReportModule,
    AccountsModule,
  ],
  controllers: [HealthController, JobsController],
})
export class AppModule {}
