import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { COMMANDS, CURRENCIES, TRANSFER_STATUSES, TRANSFER_TYPES } from '../db/schema.js';

export class ExecuteCommandDto {
  @ApiProperty({ enum: CURRENCIES })
  @IsIn(CURRENCIES)
  currency: (typeof CURRENCIES)[number];

  @ApiPropertyOptional({
    example: '10000',
    description: 'Smallest unit (cents / sen). Required for payment; refund defaults to the remaining amount; ignored for cancel.',
  })
  @IsOptional()
  @Matches(/^\d+$/)
  amount?: string;

  @ApiPropertyOptional({ description: 'Payment only: the paying customer (id)' })
  @IsOptional()
  @IsUUID()
  source?: string;

  @ApiPropertyOptional({ description: 'Payment only: the receiving customer (id), for services whose legs use {destination}' })
  @IsOptional()
  @IsUUID()
  destination?: string;

  @ApiPropertyOptional({ description: 'Refund and cancel: the payment being reversed (its source/destination are reused)' })
  @IsOptional()
  @IsUUID()
  originalTransferId?: string;

  @ApiPropertyOptional({ description: 'Service provider reference, e.g. bill number' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  externalRef?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;
}

/** POST /payments: everything else (fees, selling price, commissions, …) comes from configuration. */
export class PaymentDto {
  @ApiProperty({ example: 'MERCHANT_QR' })
  @Matches(/^[A-Z0-9_]{2,40}$/)
  serviceCode: string;

  @ApiProperty({ example: '2000', description: 'Smallest unit (cents / sen)' })
  @Matches(/^\d+$/)
  amount: string;

  @ApiProperty({ enum: CURRENCIES })
  @IsIn(CURRENCIES)
  currency: (typeof CURRENCIES)[number];

  @ApiProperty({ description: 'Paying customer (id)' })
  @IsUUID()
  source: string;

  @ApiPropertyOptional({ description: 'Receiving customer (id); required when the service movement uses {destination}' })
  @IsOptional()
  @IsUUID()
  destination?: string;

  @ApiPropertyOptional({ description: 'Service provider reference, e.g. bill number' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  externalRef?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;
}

export class RefundPaymentDto {
  @ApiPropertyOptional({ example: '1000', description: 'Defaults to the amount not yet refunded' })
  @IsOptional()
  @Matches(/^\d+$/)
  amount?: string;
}

export class TopupDto {
  @ApiProperty()
  @IsUUID()
  customerId: string;

  @ApiProperty({ enum: CURRENCIES })
  @IsIn(CURRENCIES)
  currency: (typeof CURRENCIES)[number];

  @ApiProperty({ example: '50000' })
  @Matches(/^\d+$/)
  amount: string;

  @ApiProperty({ description: 'Partner bank reference; a top-up is accepted once per reference' })
  @IsString()
  @Length(1, 200)
  externalRef: string;
}

export class CommandRouteParams {
  @ApiProperty({ example: 'EDC_BILL' })
  @Matches(/^[A-Z0-9_]{2,40}$/)
  code: string;

  @ApiProperty({ enum: COMMANDS })
  @IsIn(COMMANDS)
  command: (typeof COMMANDS)[number];
}

export class ListTransfersQuery {
  @ApiProperty({ description: 'Transfers where this customer is the source or the destination' })
  @IsUUID()
  customerId: string;

  @ApiPropertyOptional({ enum: CURRENCIES })
  @IsOptional()
  @IsIn(CURRENCIES)
  currency?: (typeof CURRENCIES)[number];

  @ApiPropertyOptional({ enum: TRANSFER_TYPES })
  @IsOptional()
  @IsIn(TRANSFER_TYPES)
  type?: (typeof TRANSFER_TYPES)[number];

  @ApiPropertyOptional({ enum: TRANSFER_STATUSES })
  @IsOptional()
  @IsIn(TRANSFER_STATUSES)
  status?: (typeof TRANSFER_STATUSES)[number];

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}
