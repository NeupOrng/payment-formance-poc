import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CreateAccountDto,
  CreateProfileDto,
  ListProfilesQuery,
  StockIdsQuery,
  UpdateAccountStatusDto,
  UpdateKycDto,
  UpdateProfileStatusDto,
} from './dto.js';
import { ProfilesService } from './profiles.service.js';

@ApiTags('profiles')
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  /** INDIVIDUAL → CURRENT account; AGENT → AGENT_FLOAT + COMMISSION; INTERNAL → none (add with POST :id/accounts). */
  @Post()
  create(@Body() dto: CreateProfileDto) {
    return this.profiles.create(dto);
  }

  @Get()
  list(@Query() query: ListProfilesQuery) {
    return this.profiles.list(query);
  }

  /** The profile with its accounts and their stocks (balances mirrored from Formance). */
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.profiles.get(id);
  }

  @Patch(':id/kyc')
  updateKyc(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateKycDto) {
    return this.profiles.updateKyc(id, dto);
  }

  @Patch(':id/status')
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProfileStatusDto) {
    return this.profiles.updateStatus(id, dto);
  }

  @Post(':id/accounts')
  addAccount(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateAccountDto) {
    return this.profiles.addAccount(id, dto);
  }
}

@ApiTags('accounts')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly profiles: ProfilesService) {}

  /** FROZEN / CLOSED applies to all of the account's stocks. */
  @Patch(':id/status')
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAccountStatusDto) {
    return this.profiles.updateAccountStatus(id, dto);
  }
}

@ApiTags('stocks')
@Controller('stocks')
export class StocksController {
  constructor(private readonly profiles: ProfilesService) {}

  /** Several stocks with their account and owner (used by the payment engine). */
  @Get()
  many(@Query() query: StockIdsQuery) {
    return this.profiles.stockViews(query.ids.split(',').filter(Boolean));
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.profiles.getStock(id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAccountStatusDto) {
    return this.profiles.updateStockStatus(id, dto);
  }
}
