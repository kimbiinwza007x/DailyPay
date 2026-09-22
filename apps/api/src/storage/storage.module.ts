import { Global, Module } from '@nestjs/common';
import { OBJECT_STORE } from './object-store';
import { SupabaseObjectStore } from './supabase-object-store';

@Global()
@Module({
  providers: [{ provide: OBJECT_STORE, useClass: SupabaseObjectStore }],
  exports: [OBJECT_STORE],
})
export class StorageModule {}
