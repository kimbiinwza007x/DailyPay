import { Global, Module } from '@nestjs/common';
import { Db } from './pool';
import { UnitOfWork } from './uow';

@Global()
@Module({
  providers: [Db, UnitOfWork],
  exports: [Db, UnitOfWork],
})
export class DbModule {}
