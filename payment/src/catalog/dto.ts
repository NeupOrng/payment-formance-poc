import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  AMOUNT_TYPES,
  BASE_AMOUNT_TYPES,
  CALC_TYPES,
  COMMAND_STATUSES,
  COMMANDS,
  CURRENCIES,
  ENTRY_SIDES,
  PARTY_ACCOUNTS,
  PRICED_AMOUNT_TYPES,
  SERVICE_STATUSES,
} from '../db/schema.js';

const DIGITS = /^\d+$/;

export class CreateServiceDto {
  @ApiProperty({ example: 'EDC_BILL' })
  @Matches(/^[A-Z0-9_]{2,40}$/)
  serviceCode: string;

  @ApiProperty({ example: 'Electricity bill' })
  @IsString()
  @Length(1, 200)
  serviceName: string;
}

export class UpdateServiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 200)
  serviceName?: string;

  @ApiPropertyOptional({ enum: SERVICE_STATUSES })
  @IsOptional()
  @IsIn(SERVICE_STATUSES)
  status?: (typeof SERVICE_STATUSES)[number];
}

export class MovementEntryDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  entryNo: number;

  @ApiProperty({ enum: ENTRY_SIDES })
  @IsIn(ENTRY_SIDES)
  side: (typeof ENTRY_SIDES)[number];

  @ApiProperty({
    example: '{source}',
    description: `${PARTY_ACCOUNTS.join(', ')}, or a specific account path such as platform:fees:{service} (currency is appended)`,
  })
  @IsString()
  @Length(1, 120)
  account: string;

  @ApiProperty({ enum: AMOUNT_TYPES })
  @IsIn(AMOUNT_TYPES)
  amountType: (typeof AMOUNT_TYPES)[number];

  @ApiPropertyOptional({ default: false, description: 'Specific accounts only: may go negative' })
  @IsOptional()
  @IsBoolean()
  allowOverdraft?: boolean;
}

export class MovementDto {
  @ApiProperty({ type: [MovementEntryDto] })
  @ValidateNested({ each: true })
  @Type(() => MovementEntryDto)
  @ArrayMinSize(2)
  @ArrayMaxSize(40)
  entries: MovementEntryDto[];
}

export class UpsertCommandDto {
  @ApiPropertyOptional({ enum: COMMAND_STATUSES, default: 'active' })
  @IsOptional()
  @IsIn(COMMAND_STATUSES)
  status?: (typeof COMMAND_STATUSES)[number];

  @ApiPropertyOptional({ default: false, description: 'Refund only: allow less than the original amount' })
  @IsOptional()
  @IsBoolean()
  allowPartial?: boolean;

  @ApiPropertyOptional({ description: 'Refund/cancel: latest minutes after the original payment' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxAgeMinutes?: number;

  @ApiPropertyOptional({ enum: PRICED_AMOUNT_TYPES, isArray: true, description: 'net_amount = amount + these …' })
  @IsOptional()
  @IsArray()
  @IsIn(PRICED_AMOUNT_TYPES, { each: true })
  netAmountAdd?: (typeof PRICED_AMOUNT_TYPES)[number][];

  @ApiPropertyOptional({ enum: PRICED_AMOUNT_TYPES, isArray: true, description: '… − these' })
  @IsOptional()
  @IsArray()
  @IsIn(PRICED_AMOUNT_TYPES, { each: true })
  netAmountSubtract?: (typeof PRICED_AMOUNT_TYPES)[number][];

}

export class CreatePricingTierDto {
  @ApiProperty({ enum: PRICED_AMOUNT_TYPES })
  @IsIn(PRICED_AMOUNT_TYPES)
  amountType: (typeof PRICED_AMOUNT_TYPES)[number];

  @ApiProperty({ enum: CURRENCIES })
  @IsIn(CURRENCIES)
  currency: (typeof CURRENCIES)[number];

  @ApiProperty({ example: '1', description: 'Band on the request amount, smallest unit, inclusive' })
  @Matches(DIGITS)
  minAmount: string;

  @ApiPropertyOptional({ example: '10000', description: 'Inclusive; omit for no upper limit' })
  @IsOptional()
  @Matches(DIGITS)
  maxAmount?: string;

  @ApiProperty({ enum: CALC_TYPES })
  @IsIn(CALC_TYPES)
  calcType: (typeof CALC_TYPES)[number];

  @ApiPropertyOptional({ enum: BASE_AMOUNT_TYPES, default: 'amount', description: 'What the percentage is taken of' })
  @IsOptional()
  @IsIn(BASE_AMOUNT_TYPES)
  baseAmountType?: (typeof BASE_AMOUNT_TYPES)[number];

  @ApiPropertyOptional({ default: false, description: 'Add the base itself: value = base + fixed + base × %' })
  @IsOptional()
  @IsBoolean()
  includeBase?: boolean;

  @ApiPropertyOptional({ example: '25' })
  @IsOptional()
  @Matches(DIGITS)
  fixedAmount?: string;

  @ApiPropertyOptional({ example: 25, description: 'Basis points, 25 = 0.25%' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  percentBps?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DIGITS)
  minValue?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DIGITS)
  maxValue?: string;

  @ApiPropertyOptional({ description: 'Defaults to now' })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}

export class RetirePricingTierDto {
  @ApiProperty({ description: 'When the tier stops applying' })
  @IsDateString()
  effectiveTo: string;
}

export class CommandParams {
  @ApiProperty({ example: 'EDC_BILL' })
  @Matches(/^[A-Z0-9_]{2,40}$/)
  code: string;

  @ApiProperty({ enum: COMMANDS })
  @IsIn(COMMANDS)
  command: (typeof COMMANDS)[number];
}
