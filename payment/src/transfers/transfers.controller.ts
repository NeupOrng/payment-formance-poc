import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  CommandRouteParams,
  ExecuteCommandDto,
  ListTransfersQuery,
  PaymentDto,
  RefundPaymentDto,
  TopupDto,
} from './dto.js';
import { TransfersService } from './transfers.service.js';

function requireIdempotencyKey(key: string | undefined) {
  if (!key || key.length > 200) {
    throw new BadRequestException('Idempotency-Key header is required (max 200 characters)');
  }
  return key;
}

@ApiTags('transfers')
@ApiHeader({ name: 'Idempotency-Key', required: true })
@Controller()
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  /**
   * Perform a payment: { serviceCode, amount, currency, source, destination? }. Selling price, fees,
   * commissions, … come from the service's pricing tiers; who pays what from its balance movement.
   */
  @Post('payments')
  pay(@Body() dto: PaymentDto, @Headers('idempotency-key') key?: string) {
    return this.transfers.pay(dto, requireIdempotencyKey(key));
  }

  /** Refund a payment (fully, or partially if the service allows it). */
  @Post('payments/:id/refund')
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundPaymentDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.transfers.reversePayment(id, 'refund', dto.amount, requireIdempotencyKey(key));
  }

  /** Cancel a payment (full amount, within the service's cancel window). */
  @Post('payments/:id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Headers('idempotency-key') key?: string) {
    return this.transfers.reversePayment(id, 'cancel', undefined, requireIdempotencyKey(key));
  }

  /** Generic form of the above: run any command of a service. */
  @Post('services/:code/:command')
  execute(
    @Param() p: CommandRouteParams,
    @Body() dto: ExecuteCommandDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.transfers.executeCommand(p.code, p.command, dto, requireIdempotencyKey(key));
  }

  @Post('topups')
  topup(@Body() dto: TopupDto, @Headers('idempotency-key') key?: string) {
    return this.transfers.topup(dto, requireIdempotencyKey(key));
  }

  @Get('transfers/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.transfers.get(id);
  }

  /** The ledger transaction behind a posted transfer: the exact postings that moved money. */
  @Get('transfers/:id/ledger')
  ledger(@Param('id', ParseUUIDPipe) id: string) {
    return this.transfers.ledgerTransaction(id);
  }

  @Get('transfers')
  list(@Query() query: ListTransfersQuery) {
    return this.transfers.list(query);
  }
}
