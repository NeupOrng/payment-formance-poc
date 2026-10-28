import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { accountStatus, CURRENCIES, productType, profileStatus, profileType } from '../db/schema.js';

export class CreateProfileDto {
  @ApiProperty({ enum: profileType.enumValues })
  @IsIn(profileType.enumValues)
  profileType: (typeof profileType.enumValues)[number];

  @ApiProperty({ example: 'Sok Dara' })
  @IsString()
  @Length(1, 140)
  fullName: string;

  @ApiPropertyOptional({ example: '+85512345678', description: 'E.164' })
  @IsOptional()
  @Matches(/^\+[1-9][0-9]{6,18}$/)
  phoneNumber?: string;

  @ApiPropertyOptional({ default: false, description: 'KYC (customers) / KYB (agents) already verified → ACTIVE' })
  @IsOptional()
  @IsBoolean()
  kycVerified?: boolean;

  @ApiPropertyOptional({ enum: CURRENCIES, isArray: true, default: CURRENCIES, description: 'Stocks to open in the default accounts' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(CURRENCIES, { each: true })
  currencies?: (typeof CURRENCIES)[number][];
}

export class ListProfilesQuery {
  @ApiPropertyOptional({ enum: profileType.enumValues })
  @IsOptional()
  @IsIn(profileType.enumValues)
  type?: (typeof profileType.enumValues)[number];

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

export class UpdateKycDto {
  @ApiProperty()
  @IsBoolean()
  kycVerified: boolean;
}

export class UpdateProfileStatusDto {
  @ApiProperty({ enum: profileStatus.enumValues })
  @IsIn(profileStatus.enumValues)
  status: (typeof profileStatus.enumValues)[number];
}

export class CreateAccountDto {
  @ApiProperty({ enum: productType.enumValues })
  @IsIn(productType.enumValues)
  productType: (typeof productType.enumValues)[number];

  @ApiPropertyOptional({ example: 'Fee income', description: 'Label; required for INTERNAL accounts' })
  @IsOptional()
  @IsString()
  @Length(1, 140)
  name?: string;

  @ApiProperty({ enum: CURRENCIES, isArray: true, example: CURRENCIES })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(CURRENCIES, { each: true })
  currencies: (typeof CURRENCIES)[number][];
}

export class UpdateAccountStatusDto {
  @ApiProperty({ enum: accountStatus.enumValues })
  @IsIn(accountStatus.enumValues)
  status: (typeof accountStatus.enumValues)[number];
}

export class StockIdsQuery {
  @ApiProperty({ description: 'Comma-separated stock ids' })
  @IsString()
  ids: string;
}

export class IdParam {
  @ApiProperty()
  @IsUUID()
  id: string;
}
