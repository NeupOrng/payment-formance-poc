import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { SagaActivitiesService } from '../temporal/saga.activities.js';
import { SagaService } from '../temporal/saga.service.js';
import { temporalClientProvider, TemporalWorkerService } from '../temporal/temporal.providers.js';
import { OrderLedgerService } from './order-ledger.service.js';
import { LedgerBalanceController, OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { SpiRunnerService } from './spi-runner.service.js';

@Module({
  imports: [CatalogModule],
  controllers: [OrdersController, LedgerBalanceController],
  providers: [
    OrdersService,
    OrderLedgerService,
    SpiRunnerService,
    temporalClientProvider,
    SagaService,
    SagaActivitiesService,
    TemporalWorkerService,
  ],
})
export class OrdersModule {}
