import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { commandType, paymentStatus } from '../db/schema.js';

const DECIMAL2 = /^\d+(\.\d{1,2})?$/;

/** POST /payments: everything else (fees, selling price, commissions, …) comes from the tier. */
export class CreatePaymentDto {
  @ApiProperty({ example: 'MERCHANT_QR_USD' })
  @Matches(/^[A-Z][A-Z0-9_]*$/)
  serviceCode: string;

  @ApiProperty({ example: '20.00', description: 'Decimal string in the service currency, at most 2 decimals' })
  @Matches(DECIMAL2)
  amount: string;

  @ApiProperty({ description: 'Payer stock (Profile Service)' })
  @IsUUID()
  payerStockId: string;

  @ApiProperty({ description: 'Payee stock (Profile Service)' })
  @IsUUID()
  payeeStockId: string;

  @ApiPropertyOptional({ example: 'BILL-2026-000123', description: 'Bill number / network reference' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  externalReference?: string;
}

export class AuthorizeDto {
  @ApiPropertyOptional({ example: 'customer:app', description: 'Who authorized (recorded in the status history)' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  by?: string;
}

export class RefundDto {
  @ApiPropertyOptional({ example: '5.00', description: 'Defaults to the amount not yet refunded' })
  @IsOptional()
  @Matches(DECIMAL2)
  amount?: string;
}

export class ListOrdersQuery {
  @ApiPropertyOptional({ description: 'Orders paid by this profile' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Orders where this stock pays or receives' })
  @IsOptional()
  @IsUUID()
  stockId?: string;

  @ApiPropertyOptional({ enum: paymentStatus.enumValues })
  @IsOptional()
  @IsIn(paymentStatus.enumValues)
  status?: (typeof paymentStatus.enumValues)[number];

  @ApiPropertyOptional({ enum: commandType.enumValues })
  @IsOptional()
  @IsIn(commandType.enumValues)
  commandType?: (typeof commandType.enumValues)[number];

  @ApiPropertyOptional({ default: 50 })
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
