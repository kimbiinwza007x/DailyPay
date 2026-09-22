import { Module } from '@nestjs/common';
import { ImportModule } from '../modules/import/import.module';
import { JobRunner } from './job-runner';

@Module({
  imports: [ImportModule],
  providers: [JobRunner],
  exports: [JobRunner],
})
export class WorkerModule {}
