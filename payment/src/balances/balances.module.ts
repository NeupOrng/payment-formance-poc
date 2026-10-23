import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { TransfersModule } from '../transfers/transfers.module.js';
import { BalancesController } from './balances.controller.js';

@Module({
  imports: [TransfersModule, CatalogModule],
  controllers: [BalancesController],
})
export class BalancesModule {}
