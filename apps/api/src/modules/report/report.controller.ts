import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  type AccountBalanceDto,
  type LedgerEntryDto,
  ledgerQuerySchema,
  type MonthlyReportDto,
} from '@dailypay/shared';
import { SupabaseAuthGuard } from '../../auth/supabase-auth.guard';
import { ZodValidationPipe } from '../../zod-validation.pipe';
import { ReportService } from './report.service';

function currentMonthInBangkok(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
  })
    .format(new Date())
    .slice(0, 7);
}

@Controller()
@UseGuards(SupabaseAuthGuard)
export class ReportController {
  constructor(private readonly report: ReportService) {}

  /** month = 'YYYY-MM' (ค่าเริ่มต้น: เดือนปัจจุบันตามเวลาไทย) */
  @Get('reports/monthly')
  monthly(@Query('month') month?: string): Promise<MonthlyReportDto> {
    const target = /^\d{4}-\d{2}$/.test(month ?? '') ? month! : currentMonthInBangkok();
    return this.report.monthly(target);
  }

  @Get('reports/reconcile')
  reconcile(): Promise<AccountBalanceDto[]> {
    return this.report.accountBalances();
  }

  @Get('reports/summary')
  async summary(): Promise<{ needsReview: number; balances: AccountBalanceDto[] }> {
    const [needsReview, balances] = await Promise.all([
      this.report.needsReviewCount(),
      this.report.accountBalances(),
    ]);
    return { needsReview, balances };
  }

  @Get('ledger')
  ledger(
    @Query(new ZodValidationPipe(ledgerQuerySchema))
    query: import('@dailypay/shared').LedgerQuery,
  ): Promise<LedgerEntryDto[]> {
    return this.report.ledger(query);
  }
}
