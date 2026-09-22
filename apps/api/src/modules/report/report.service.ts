/**
 * รายงานทุกตัวต้อง query จาก v_ledger / view ที่มาจากมันเท่านั้น
 * ห้าม query transactions ตรง ๆ เพราะจะนับการโอนระหว่างบัญชีตัวเองเป็นรายจ่าย
 * (design.md ข้อ 1 กฎข้อ 3)
 */
import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type {
  AccountBalanceDto,
  CategoryTotalDto,
  LedgerEntryDto,
  LedgerQuery,
  MonthlyReportDto,
} from '@dailypay/shared';
import { UnitOfWork } from '../../db/uow';

interface CategoryTotalRow {
  month: string;
  category_id: string | null;
  category_path: string | null;
  kind: 'expense' | 'income' | 'transfer' | null;
  total: string;
  tx_count: string;
}

@Injectable()
export class ReportService {
  constructor(private readonly uow: UnitOfWork) {}

  /** month: 'YYYY-MM' */
  async monthly(month: string): Promise<MonthlyReportDto> {
    const firstDay = `${month}-01`;
    const rows = await this.uow.read((tx) =>
      tx.query<CategoryTotalRow>(
        `select month, category_id, category_path, kind, total, tx_count
           from v_monthly_by_category
          where month = date_trunc('month', $1::date)::date
          order by kind, total`,
        [firstDay],
      ),
    );

    const byCategory: CategoryTotalDto[] = rows.map((r) => ({
      month: r.month,
      categoryId: r.category_id,
      categoryPath: r.category_path ?? 'ยังไม่จัดหมวด',
      kind: r.kind,
      total: r.total,
      txCount: Number(r.tx_count),
    }));

    // amount ติดลบ = เงินออก จึง sum ตรง ๆ แล้วแยกทีหลังด้วยเครื่องหมาย
    let income = new Decimal(0);
    let expense = new Decimal(0);
    for (const row of byCategory) {
      const total = new Decimal(row.total);
      if (total.isNegative()) expense = expense.plus(total.abs());
      else income = income.plus(total);
    }

    return {
      month,
      income: income.toFixed(2),
      expense: expense.toFixed(2),
      net: income.minus(expense).toFixed(2),
      byCategory,
    };
  }

  async accountBalances(): Promise<AccountBalanceDto[]> {
    const rows = await this.uow.read((tx) =>
      tx.query<{
        id: string;
        name: string;
        computed_balance: string;
        statement_balance: string | null;
        statement_as_of: string | null;
        diff: string | null;
      }>(
        `select id, name, computed_balance, statement_balance, statement_as_of, diff
           from v_account_balance
          order by name`,
      ),
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      computedBalance: r.computed_balance,
      statementBalance: r.statement_balance,
      statementAsOf: r.statement_as_of,
      diff: r.diff,
    }));
  }

  async needsReviewCount(): Promise<number> {
    const rows = await this.uow.read((tx) =>
      tx.query<{ count: string }>('select count(*) as count from v_ledger where needs_review'),
    );
    return Number(rows[0]?.count ?? 0);
  }

  async ledger(q: LedgerQuery): Promise<LedgerEntryDto[]> {
    const rows = await this.uow.read((tx) =>
      tx.query<{
        id: string;
        account_id: string;
        account_name: string;
        booked_date: string;
        occurred_at: Date | null;
        amount: string;
        description_raw: string | null;
        counterparty: string | null;
        category_id: string | null;
        category_path: string | null;
        bank_ref: string | null;
        needs_review: boolean;
        note: string | null;
      }>(
        `select l.id, l.account_id, a.name as account_name, l.booked_date, l.occurred_at,
                l.amount, l.description_raw, l.counterparty, l.category_id,
                coalesce(p.name || ' › ', '') || c.name as category_path,
                l.bank_ref, l.needs_review, l.note
           from v_ledger l
           join accounts a on a.id = l.account_id
           left join categories c on c.id = l.category_id
           left join categories p on p.id = c.parent_id
          where ($1::uuid is null or l.account_id = $1)
            and ($2::uuid is null or l.category_id = $2)
            and ($3::date is null or l.booked_date >= $3)
            and ($4::date is null or l.booked_date <= $4)
            and ($5::boolean is null or l.needs_review = $5)
          order by l.booked_date desc, l.created_at desc
          limit $6 offset $7`,
        [
          q.accountId ?? null,
          q.categoryId ?? null,
          q.from ?? null,
          q.to ?? null,
          q.needsReview ?? null,
          q.limit,
          q.offset,
        ],
      ),
    );

    return rows.map((r) => ({
      id: r.id,
      accountId: r.account_id,
      accountName: r.account_name,
      bookedDate: r.booked_date,
      occurredAt: r.occurred_at ? r.occurred_at.toISOString() : null,
      amount: r.amount,
      descriptionRaw: r.description_raw,
      counterparty: r.counterparty,
      categoryId: r.category_id,
      categoryPath: r.category_path,
      bankRef: r.bank_ref,
      needsReview: r.needs_review,
      note: r.note,
    }));
  }
}
