import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service.js';
import {
  CommandParams,
  CreatePricingTierDto,
  CreateServiceDto,
  MovementDto,
  RetirePricingTierDto,
  UpdateServiceDto,
  UpsertCommandDto,
} from './dto.js';

@ApiTags('catalog')
@Controller()
export class ServicesController {
  constructor(private readonly catalog: CatalogService) {}

  @Post('services')
  create(@Body() dto: CreateServiceDto) {
    return this.catalog.createService(dto);
  }

  @Get('services')
  list() {
    return this.catalog.listServices();
  }

  @Get('services/:code')
  get(@Param('code') code: string) {
    return this.catalog.getService(code);
  }

  @Patch('services/:code')
  update(@Param('code') code: string, @Body() dto: UpdateServiceDto) {
    return this.catalog.updateService(code, dto);
  }

  @Put('services/:code/commands/:command')
  upsertCommand(@Param() p: CommandParams, @Body() dto: UpsertCommandDto) {
    return this.catalog.upsertCommand(p.code, p.command, dto);
  }

  /** Dry run: does this movement balance with the command's current pricing tiers? */
  @Post('services/:code/commands/:command/movement/check')
  checkMovement(@Param() p: CommandParams, @Body() dto: MovementDto) {
    return this.catalog.checkMovement(p.code, p.command, dto);
  }

  /** Saves the debit/credit entries; 400 with the failing amounts if they do not balance. */
  @Put('services/:code/commands/:command/movement')
  setMovement(@Param() p: CommandParams, @Body() dto: MovementDto) {
    return this.catalog.setMovement(p.code, p.command, dto);
  }

  @Post('services/:code/commands/:command/pricing-tiers')
  addPricingTier(@Param() p: CommandParams, @Body() dto: CreatePricingTierDto) {
    return this.catalog.addPricingTier(p.code, p.command, dto);
  }

  @Patch('pricing-tiers/:id')
  retirePricingTier(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RetirePricingTierDto) {
    return this.catalog.retirePricingTier(id, dto);
  }
}
