import { Module } from '@nestjs/common';
import { ProfileClient } from '../profile/profile.client.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, ProfileClient],
  exports: [CatalogService, ProfileClient],
})
export class CatalogModule {}
