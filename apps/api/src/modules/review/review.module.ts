import { Module } from '@nestjs/common';
import { CommitService } from './commit.service';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

@Module({
  controllers: [ReviewController],
  providers: [ReviewService, CommitService],
  exports: [CommitService],
})
export class ReviewModule {}
