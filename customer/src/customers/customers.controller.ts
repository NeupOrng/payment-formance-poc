import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CustomersService } from './customers.service.js';
import {
  CreateCustomerDto,
  AccountByCurrencyParams,
  UpdateAccountStatusDto,
  UpdateCustomerStatusDto,
  UpdateKycDto,
} from './dto.js';

@ApiTags('customers')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Post()
  create(@Body() dto: CreateCustomerDto) {
    return this.customers.create(dto);
  }

  @Get()
  list(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.customers.list(Math.min(limit, 200), offset);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(id);
  }

  @Patch(':id/kyc')
  updateKyc(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateKycDto) {
    return this.customers.updateKyc(id, dto);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerStatusDto,
  ) {
    return this.customers.updateStatus(id, dto);
  }

  @Get(':id/accounts')
  accounts(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.accountsOf(id);
  }

  @Get(':id/accounts/:currency')
  accountByCurrency(@Param() params: AccountByCurrencyParams) {
    return this.customers.accountByCurrency(params.id, params.currency);
  }
}

@ApiTags('accounts')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly customers: CustomersService) {}

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.getAccount(id);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountStatusDto,
  ) {
    return this.customers.updateAccountStatus(id, dto);
  }
}
