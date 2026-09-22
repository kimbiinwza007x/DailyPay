import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  type AccountDto,
  type CategoryDto,
  createAccountSchema,
  type CreateAccountInput,
} from '@dailypay/shared';
import { SupabaseAuthGuard } from '../../auth/supabase-auth.guard';
import { ZodValidationPipe } from '../../zod-validation.pipe';
import { AccountsService } from './accounts.service';

@Controller()
@UseGuards(SupabaseAuthGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get('accounts')
  list(): Promise<AccountDto[]> {
    return this.accounts.list();
  }

  @Post('accounts')
  create(
    @Body(new ZodValidationPipe(createAccountSchema)) body: CreateAccountInput,
  ): Promise<AccountDto> {
    return this.accounts.create(body);
  }

  @Get('categories')
  categories(): Promise<CategoryDto[]> {
    return this.accounts.categories();
  }
}
