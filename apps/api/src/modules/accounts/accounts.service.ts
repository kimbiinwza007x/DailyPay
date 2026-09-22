import { Injectable } from '@nestjs/common';
import type { AccountDto, CategoryDto, CreateAccountInput } from '@dailypay/shared';
import { UnitOfWork } from '../../db/uow';

interface AccountRow {
  id: string;
  name: string;
  type: AccountDto['type'];
  currency: string;
  last4: string | null;
  opening_balance: string;
  archived_at: Date | null;
}

@Injectable()
export class AccountsService {
  constructor(private readonly uow: UnitOfWork) {}

  async list(): Promise<AccountDto[]> {
    const rows = await this.uow.read((tx) =>
      tx.query<AccountRow>(
        `select id, name, type, currency, last4, opening_balance, archived_at
           from accounts
          where archived_at is null
          order by name`,
      ),
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      currency: r.currency,
      last4: r.last4,
      openingBalance: r.opening_balance,
      archivedAt: r.archived_at ? r.archived_at.toISOString() : null,
    }));
  }

  async create(input: CreateAccountInput): Promise<AccountDto> {
    const rows = await this.uow.run((tx) =>
      tx.query<AccountRow>(
        `insert into accounts (name, type, currency, last4, opening_balance, statement_day, note)
         values ($1, $2, $3, $4, $5::numeric, $6, $7)
         returning id, name, type, currency, last4, opening_balance, archived_at`,
        [
          input.name,
          input.type,
          input.currency,
          input.last4 ?? null,
          input.openingBalance,
          input.statementDay ?? null,
          input.note ?? null,
        ],
      ),
    );
    const r = rows[0]!;
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      currency: r.currency,
      last4: r.last4,
      openingBalance: r.opening_balance,
      archivedAt: null,
    };
  }

  /** หมวดหมู่พร้อม path 'อาหาร › ทานนอกบ้าน' สำหรับ dropdown ในหน้าตรวจ */
  async categories(): Promise<CategoryDto[]> {
    const rows = await this.uow.read((tx) =>
      tx.query<{
        id: string;
        code: string | null;
        parent_id: string | null;
        name: string;
        kind: CategoryDto['kind'];
        icon: string | null;
        path: string;
      }>(
        `select c.id, c.code, c.parent_id, c.name, c.kind, c.icon,
                coalesce(p.name || ' › ', '') || c.name as path
           from categories c
           left join categories p on p.id = c.parent_id
          where c.archived_at is null
          order by coalesce(p.sort_order, c.sort_order), c.sort_order, c.name`,
      ),
    );
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      parentId: r.parent_id,
      name: r.name,
      kind: r.kind,
      icon: r.icon,
      path: r.path,
    }));
  }
}
