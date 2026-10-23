import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CustomerClient } from '../customers/customer.client.js';
import { LedgerPoster } from './ledger-poster.service.js';
import { OutboxWorker } from './outbox.worker.js';
import { TransfersController } from './transfers.controller.js';
import { TransfersService } from './transfers.service.js';

@Module({
  imports: [CatalogModule],
  controllers: [TransfersController],
  providers: [TransfersService, LedgerPoster, OutboxWorker, CustomerClient],
  exports: [CustomerClient],
})
export class TransfersModule {}
