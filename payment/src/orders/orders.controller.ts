import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { assetFor, toDecimal } from '../common/money.js';
import { LedgerClient } from '../ledger/ledger.client.js';
import { holdAccount } from '../movement/movement.js';
import { ProfileClient } from '../profile/profile.client.js';
import { SagaService, type SagaResponse } from '../temporal/saga.service.js';
import { AuthorizeDto, CreatePaymentDto, ListOrdersQuery, RefundDto } from './dto.js';
import { OrdersService } from './orders.service.js';

function requireKey(key: string | undefined) {
  if (!key || key.length > 64) throw new BadRequestException('Idempotency-Key header is required (max 64 characters)');
  return key;
}

function reply(res: Response, { statusCode, body }: SagaResponse) {
  res.status(statusCode);
  return body;
}

@ApiTags('payments')
@ApiResponse({ status: 201, description: 'The saga reached the expected point (awaiting authorization, or finished)' })
@ApiResponse({ status: 202, description: 'The saga is still busy (e.g. a slow provider): poll GET /payments/:id' })
@Controller()
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly saga: SagaService,
  ) {}

  /** Creates a PAYMENT order. It is priced and its money reserved, then it waits for authorization. */
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('payments')
  async create(@Body() dto: CreatePaymentDto, @Res({ passthrough: true }) res: Response, @Headers('idempotency-key') key?: string) {
    return reply(res, await this.saga.createPayment(dto, requireKey(key)));
  }

  /** Customer authentication (PIN / OTP in a real app): the order is processed. */
  @Post('payments/:id/authorize')
  async authorize(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AuthorizeDto, @Res({ passthrough: true }) res: Response) {
    return reply(res, await this.saga.authorize(id, dto.by));
  }

  /** PENDING: cancel before authorization. COMPLETED: a CANCEL order that reverses it. */
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('payments/:id/cancel')
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response, @Headers('idempotency-key') key?: string) {
    return reply(res, await this.saga.cancel(id, requireKey(key)));
  }

  /** A REFUND order for a COMPLETED payment (partial, or the rest by default). */
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('payments/:id/refund')
  async refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') key?: string,
  ) {
    return reply(res, await this.saga.refund(id, dto.amount, requireKey(key)));
  }

  @Get('payments')
  list(@Query() query: ListOrdersQuery) {
    return this.orders.list(query);
  }

  /** The order with its amounts, balance movements, ledger transactions and status history. */
  @Get('payments/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(id);
  }

  /** The order's Formance transactions (reserve, settle, revert, release) with their postings. */
  @Get('payments/:id/ledger')
  ledger(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.ledgerTransactions(id);
  }
}

@ApiTags('balances')
@Controller()
export class LedgerBalanceController {
  constructor(
    private readonly profiles: ProfileClient,
    private readonly ledger: LedgerClient,
  ) {}

  /** A stock's balances straight from Formance (the Profile Service mirrors these into the stock table). */
  @Get('stocks/:id/ledger-balance')
  async balance(@Param('id', ParseUUIDPipe) id: string) {
    const stock = await this.profiles.stock(id);
    const asset = assetFor(stock.currency);
    const volumes = await this.ledger.getVolumes(stock.ledgerAccount);
    const available = BigInt(volumes[asset]?.balance ?? 0);
    const held = await this.ledger.aggregateBalance(holdAccount(stock.stockNumber, ''), asset);
    return {
      stockId: id,
      ledgerAccount: stock.ledgerAccount,
      currency: stock.currency,
      ledgerBalance: toDecimal(available + held),
      holdAmount: toDecimal(held),
      availableBalance: toDecimal(available),
    };
  }
}
