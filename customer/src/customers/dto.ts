import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID, Length, Matches } from 'class-validator';
import {
  ACCOUNT_STATUSES,
  CURRENCIES,
  CUSTOMER_STATUSES,
  KYC_STATUSES,
} from '../db/schema.js';

export class CreateCustomerDto {
  @ApiProperty({ example: 'Sok Dara' })
  @IsString()
  @Length(1, 200)
  fullName: string;

  @ApiProperty({ example: '+85512345678' })
  @Matches(/^\+?[0-9]{6,20}$/)
  phoneNumber: string;
}

export class UpdateKycDto {
  @ApiProperty({ enum: KYC_STATUSES })
  @IsIn(KYC_STATUSES)
  kycStatus: (typeof KYC_STATUSES)[number];
}

export class UpdateCustomerStatusDto {
  @ApiProperty({ enum: CUSTOMER_STATUSES })
  @IsIn(CUSTOMER_STATUSES)
  status: (typeof CUSTOMER_STATUSES)[number];
}

export class UpdateAccountStatusDto {
  @ApiProperty({ enum: ACCOUNT_STATUSES })
  @IsIn(ACCOUNT_STATUSES)
  status: (typeof ACCOUNT_STATUSES)[number];
}

export class AccountByCurrencyParams {
  @ApiProperty()
  @IsUUID()
  id: string;

  @ApiProperty({ enum: CURRENCIES })
  @IsIn(CURRENCIES)
  currency: (typeof CURRENCIES)[number];
}
