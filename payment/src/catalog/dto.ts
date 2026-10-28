import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  calcMethod,
  commandType,
  configStatus,
  CURRENCIES,
  spiAuthType,
  spiProtocol,
  spiTrigger,
  spiType,
  stockRole,
} from '../db/schema.js';

const CODE = /^[A-Z][A-Z0-9_]*$/;
const DECIMAL2 = /^\d+(\.\d{1,2})?$/;
const DECIMAL6 = /^\d{1,3}(\.\d{1,6})?$/;

export class CreateAmountTypeDto {
  @ApiProperty({ example: 'SELLING_PRICE' })
  @Matches(CODE)
  @Length(1, 30)
  code: string;

  @ApiProperty({ example: 'Selling price' })
  @IsString()
  @Length(1, 100)
  name: string;
}

export class CreateServiceGroupDto {
  @ApiProperty({ example: 'Bill payments' })
  @IsString()
  @Length(1, 140)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 255)
  description?: string;
}

export class UpdateServiceGroupDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 140)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 255)
  description?: string;

  @ApiPropertyOptional({ enum: configStatus.enumValues, description: 'INACTIVE turns off every service in the group' })
  @IsOptional()
  @IsIn(configStatus.enumValues)
  status?: (typeof configStatus.enumValues)[number];
}

export class CreateServiceDto {
  @ApiProperty()
  @IsUUID()
  serviceGroupId: string;

  @ApiProperty({ example: 'EDC_BILL_USD' })
  @Matches(CODE)
  @Length(2, 50)
  code: string;

  @ApiProperty({ example: 'Electricity bill (USD)' })
  @IsString()
  @Length(1, 140)
  name: string;

  @ApiProperty({ enum: CURRENCIES, description: 'One currency per service' })
  @IsIn(CURRENCIES)
  currency: (typeof CURRENCIES)[number];
}

export class UpdateServiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 140)
  name?: string;

  @ApiPropertyOptional({ enum: configStatus.enumValues })
  @IsOptional()
  @IsIn(configStatus.enumValues)
  status?: (typeof configStatus.enumValues)[number];
}

export class UpsertCommandDto {
  @ApiPropertyOptional({ enum: configStatus.enumValues, default: 'ACTIVE' })
  @IsOptional()
  @IsIn(configStatus.enumValues)
  status?: (typeof configStatus.enumValues)[number];
}

export class InternalSpiConfigDto {
  @ApiProperty({ example: 'sanctions-screening', description: 'Handler inside the payment engine' })
  @IsString()
  @Length(1, 140)
  handlerName: string;

  @ApiPropertyOptional({ default: 10_000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  timeoutMs?: number;
}

export class ExternalSpiConfigDto {
  @ApiProperty({ example: 'http://partner-mock:3000' })
  @IsUrl({ require_tld: false, require_protocol: true })
  baseUrl: string;

  @ApiProperty({ enum: spiProtocol.enumValues })
  @IsIn(spiProtocol.enumValues)
  protocol: (typeof spiProtocol.enumValues)[number];

  @ApiProperty({ enum: spiAuthType.enumValues })
  @IsIn(spiAuthType.enumValues)
  authType: (typeof spiAuthType.enumValues)[number];

  @ApiPropertyOptional({ description: 'Name of the secret (env var / vault key); never the secret itself' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  credentialRef?: string;

  @ApiPropertyOptional({ default: 30_000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  timeoutMs?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  maxRetries?: number;
}

export class CreateSpiDto {
  @ApiProperty({ example: 'EDC_BILLER' })
  @Matches(CODE)
  @Length(2, 50)
  code: string;

  @ApiProperty({ example: 'EDC biller API' })
  @IsString()
  @Length(1, 140)
  name: string;

  @ApiProperty({ enum: spiType.enumValues })
  @IsIn(spiType.enumValues)
  spiType: (typeof spiType.enumValues)[number];

  @ApiPropertyOptional({ type: InternalSpiConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => InternalSpiConfigDto)
  internal?: InternalSpiConfigDto;

  @ApiPropertyOptional({ type: ExternalSpiConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExternalSpiConfigDto)
  external?: ExternalSpiConfigDto;
}

export class StatusDto {
  @ApiProperty({ enum: configStatus.enumValues })
  @IsIn(configStatus.enumValues)
  status: (typeof configStatus.enumValues)[number];
}

export class AddCommandSpiDto {
  @ApiProperty({ example: 'EDC_BILLER' })
  @Matches(CODE)
  spiCode: string;

  @ApiProperty({ enum: spiTrigger.enumValues })
  @IsIn(spiTrigger.enumValues)
  triggerStage: (typeof spiTrigger.enumValues)[number];

  @ApiProperty({ example: 1, description: 'Order within the stage' })
  @IsInt()
  @Min(1)
  executionSequence: number;

  @ApiProperty({ example: 'POST /confirmations', description: "External: 'METHOD /path'; internal: free text passed to the handler" })
  @IsString()
  @Length(1, 200)
  spiOperation: string;
}

export class TierRuleDto {
  @ApiProperty({ example: 'FEE_FROM_CUSTOMER' })
  @Matches(CODE)
  amountType: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  calcSequence: number;

  @ApiProperty({ enum: calcMethod.enumValues })
  @IsIn(calcMethod.enumValues)
  calcMethod: (typeof calcMethod.enumValues)[number];

  @ApiPropertyOptional({ example: 'AMOUNT', description: 'FIXED: what the percentage is taken of' })
  @IsOptional()
  @Matches(CODE)
  baseAmountType?: string;

  @ApiPropertyOptional({ example: '0.50' })
  @IsOptional()
  @Matches(DECIMAL2)
  fixedValue?: string;

  @ApiPropertyOptional({ example: '5', description: '5 = 5%' })
  @IsOptional()
  @Matches(DECIMAL6)
  percentage?: string;

  @ApiPropertyOptional({ example: 'FEE_FROM_CUSTOMER + AMOUNT' })
  @IsOptional()
  @Matches(/^[A-Z0-9_ .+\-*/()]+$/)
  @Length(1, 500)
  formulaExpression?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DECIMAL2)
  minValue?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DECIMAL2)
  maxValue?: string;
}

export class TierMovementDto {
  @ApiProperty({ example: 1, description: 'Posting order' })
  @IsInt()
  @Min(1)
  movementSequence: number;

  @ApiProperty({ example: 'AMOUNT' })
  @Matches(CODE)
  amountType: string;

  @ApiProperty({ enum: stockRole.enumValues })
  @IsIn(stockRole.enumValues)
  fromStockRole: (typeof stockRole.enumValues)[number];

  @ApiPropertyOptional({ description: 'Required when fromStockRole is SPECIFIC' })
  @IsOptional()
  @IsUUID()
  fromStockId?: string;

  @ApiProperty({ enum: stockRole.enumValues })
  @IsIn(stockRole.enumValues)
  toStockRole: (typeof stockRole.enumValues)[number];

  @ApiPropertyOptional({ description: 'Required when toStockRole is SPECIFIC' })
  @IsOptional()
  @IsUUID()
  toStockId?: string;
}

export class CreateTierDto {
  @ApiPropertyOptional({ example: '0.01', description: 'Inclusive; omit for no lower limit' })
  @IsOptional()
  @Matches(DECIMAL2)
  minAmount?: string;

  @ApiPropertyOptional({ example: '40.01', description: 'Exclusive; omit for no upper limit' })
  @IsOptional()
  @Matches(DECIMAL2)
  maxAmount?: string;

  @ApiProperty({ type: [TierRuleDto] })
  @ValidateNested({ each: true })
  @Type(() => TierRuleDto)
  @ArrayMaxSize(30)
  rules: TierRuleDto[];

  @ApiProperty({ type: [TierMovementDto] })
  @ValidateNested({ each: true })
  @Type(() => TierMovementDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  movements: TierMovementDto[];
}

export class PreviewTierDto {
  @ApiProperty({ example: '20.00' })
  @Matches(DECIMAL2)
  amount: string;
}

export class CommandParams {
  @ApiProperty({ example: 'EDC_BILL_USD' })
  @Matches(CODE)
  code: string;

  @ApiProperty({ enum: commandType.enumValues })
  @IsIn(commandType.enumValues)
  commandType: (typeof commandType.enumValues)[number];
}
