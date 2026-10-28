import { Module } from '@nestjs/common';
import { LedgerReader } from '../ledger-sync/ledger-reader.js';
import { LedgerSyncController } from '../ledger-sync/ledger-sync.controller.js';
import { LedgerSyncService } from '../ledger-sync/ledger-sync.service.js';
import { AccountsController, ProfilesController, StocksController } from './profiles.controller.js';
import { ProfilesService } from './profiles.service.js';

@Module({
  controllers: [ProfilesController, AccountsController, StocksController, LedgerSyncController],
  providers: [ProfilesService, LedgerReader, LedgerSyncService],
})
export class ProfilesModule {}
