import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  BatchDetailDto,
  BatchStatus,
  BatchSummaryDto,
  ParsedRowDto,
  ReviewRowDto,
} from '@dailypay/shared';
import type { BatchRow } from '../../db/repos/batch.repo';
import { UnitOfWork } from '../../db/uow';

function toSummary(b: BatchRow): BatchSummaryDto {
  return {
    id: b.id,
    fileName: b.file_name,
    source: b.source,
    status: b.status,
    rowCount: b.row_count,
    importedCount: b.imported_count,
    duplicateCount: b.duplicate_count,
    reviewCount: b.review_count,
    errorMessage: b.error_message,
    createdAt: b.created_at.toISOString(),
    committedAt: b.committed_at ? b.committed_at.toISOString() : null,
  };
}

@Injectable()
export class ReviewService {
  constructor(private readonly uow: UnitOfWork) {}

  async list(status: BatchStatus | null): Promise<BatchSummaryDto[]> {
    const rows = await this.uow.read((tx) => tx.batches.listByStatus(status));
    return rows.map(toSummary);
  }

  async detail(batchId: string): Promise<BatchDetailDto> {
    return this.uow.read(async (tx) => {
      let batch: BatchRow;
      try {
        batch = await tx.batches.get(batchId);
      } catch {
        throw new NotFoundException(`ไม่พบ batch ${batchId}`);
      }
      const rows = await tx.rawRows.listForBatch(batchId);
      const mapped: ReviewRowDto[] = rows.map((r) => ({
        id: r.id,
        lineNo: r.line_no,
        parsed: (r.parsed as ParsedRowDto | null) ?? null,
        dedupe: r.dedupe,
        dupOf: r.dup_of,
        proposedCategoryId: r.proposed_category_id,
        proposedCategoryName: r.proposed_category_name,
        confidence: r.confidence,
        parseStatus: r.parse_status,
        parseError: r.parse_error,
      }));
      return { batch: toSummary(batch), rows: mapped };
    });
  }
}
