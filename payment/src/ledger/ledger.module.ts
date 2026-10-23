import { Global, Module } from '@nestjs/common';
import { LedgerClient } from './ledger.client.js';

@Global()
@Module({
  providers: [LedgerClient],
  exports: [LedgerClient],
})
export class LedgerModule {}
