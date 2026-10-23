import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BalancesModule } from './balances/balances.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthController } from './health/health.controller.js';
import { LedgerModule } from './ledger/ledger.module.js';
import { TransfersModule } from './transfers/transfers.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    LedgerModule,
    CatalogModule,
    TransfersModule,
    BalancesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
