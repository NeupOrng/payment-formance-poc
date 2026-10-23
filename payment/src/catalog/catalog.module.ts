import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service.js';
import { ServicesController } from './services.controller.js';

@Module({
  controllers: [ServicesController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
