import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type BatchDetailDto,
  type BatchStatus,
  type BatchSummaryDto,
  type CommitBatchInput,
  type CommitResultDto,
  commitBatchSchema,
} from '@dailypay/shared';
import { SupabaseAuthGuard } from '../../auth/supabase-auth.guard';
import { QueueKicker } from '../../worker/queue-kicker';
import { ZodValidationPipe } from '../../zod-validation.pipe';
import { CommitService } from './commit.service';
import { ReviewService } from './review.service';

@Controller('batches')
@UseGuards(SupabaseAuthGuard)
export class ReviewController {
  constructor(
    private readonly review: ReviewService,
    private readonly commitService: CommitService,
    private readonly kicker: QueueKicker,
  ) {}

  @Get()
  list(@Query('status') status?: BatchStatus): Promise<BatchSummaryDto[]> {
    return this.review.list(status ?? null);
  }

  @Get(':batchId')
  detail(@Param('batchId', ParseUUIDPipe) batchId: string): Promise<BatchDetailDto> {
    return this.review.detail(batchId);
  }

  @Post(':batchId/commit')
  async commit(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Body(new ZodValidationPipe(commitBatchSchema)) body: CommitBatchInput,
  ): Promise<CommitResultDto> {
    const result = await this.commitService.commit(batchId, body);
    // commit enqueue pair_transfers + reconcile ไว้ — ทำเลยไม่ต้องรอ cron วันรุ่งขึ้น
    this.kicker.kick('หลัง commit');
    return result;
  }

  @Delete(':batchId')
  async revert(
    @Param('batchId', ParseUUIDPipe) batchId: string,
  ): Promise<{ deleted: number }> {
    return { deleted: await this.commitService.revert(batchId) };
  }
}
