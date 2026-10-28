import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service.js';
import {
  AddCommandSpiDto,
  CommandParams,
  CreateAmountTypeDto,
  CreateServiceDto,
  CreateServiceGroupDto,
  CreateSpiDto,
  CreateTierDto,
  PreviewTierDto,
  StatusDto,
  UpdateServiceDto,
  UpdateServiceGroupDto,
  UpsertCommandDto,
} from './dto.js';

@ApiTags('configuration')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('amount-types')
  listAmountTypes() {
    return this.catalog.listAmountTypes();
  }

  @Post('amount-types')
  createAmountType(@Body() dto: CreateAmountTypeDto) {
    return this.catalog.createAmountType(dto);
  }

  @Get('service-groups')
  listGroups() {
    return this.catalog.listGroups();
  }

  @Post('service-groups')
  createGroup(@Body() dto: CreateServiceGroupDto) {
    return this.catalog.createGroup(dto);
  }

  @Patch('service-groups/:id')
  updateGroup(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateServiceGroupDto) {
    return this.catalog.updateGroup(id, dto);
  }

  @Get('services')
  listServices() {
    return this.catalog.listServices();
  }

  @Post('services')
  createService(@Body() dto: CreateServiceDto) {
    return this.catalog.createService(dto);
  }

  /** Full configuration: commands, SPI calls, tiers with amount rules and balance movements. */
  @Get('services/:code')
  getService(@Param('code') code: string) {
    return this.catalog.getService(code);
  }

  @Patch('services/:code')
  updateService(@Param('code') code: string, @Body() dto: UpdateServiceDto) {
    return this.catalog.updateService(code, dto);
  }

  @Put('services/:code/commands/:commandType')
  upsertCommand(@Param() p: CommandParams, @Body() dto: UpsertCommandDto) {
    return this.catalog.upsertCommand(p.code, p.commandType, dto);
  }

  @Post('services/:code/commands/:commandType/spis')
  addCommandSpi(@Param() p: CommandParams, @Body() dto: AddCommandSpiDto) {
    return this.catalog.addCommandSpi(p.code, p.commandType, dto);
  }

  /** A tier with its amount rules and balance movements, validated before it is saved. */
  @Post('services/:code/commands/:commandType/tiers')
  createTier(@Param() p: CommandParams, @Body() dto: CreateTierDto) {
    return this.catalog.createTier(p.code, p.commandType, dto);
  }

  @Get('tiers/:id')
  getTier(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getTier(id);
  }

  /** Tiers are immutable; switch one off and create a new one to change prices. */
  @Patch('tiers/:id')
  updateTier(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto) {
    return this.catalog.updateTier(id, dto);
  }

  @Post('tiers/:id/preview')
  previewTier(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PreviewTierDto) {
    return this.catalog.previewTier(id, dto.amount);
  }

  @Get('spis')
  listSpis() {
    return this.catalog.listSpis();
  }

  @Post('spis')
  createSpi(@Body() dto: CreateSpiDto) {
    return this.catalog.createSpi(dto);
  }

  @Patch('spis/:code')
  updateSpi(@Param('code') code: string, @Body() dto: StatusDto) {
    return this.catalog.updateSpi(code, dto);
  }

  @Patch('command-spis/:id')
  updateCommandSpi(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto) {
    return this.catalog.updateCommandSpi(id, dto);
  }
}
