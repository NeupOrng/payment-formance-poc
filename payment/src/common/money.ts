import { BadRequestException } from '@nestjs/common';
import type { Currency } from '../db/schema.js';

export const ASSETS: Record<Currency, string> = { USD: 'USD/2', KHR: 'KHR/2' };

// Formance returns amounts as JSON numbers, so stay within the exact integer range of a double.
export const MAX_AMOUNT = BigInt(Number.MAX_SAFE_INTEGER);

/** Parses an amount in the smallest unit (e.g. cents) sent as a string of digits. */
export function parseAmount(value: string, field = 'amount'): bigint {
  if (!/^\d+$/.test(value)) {
    throw new BadRequestException(`${field} must be a string of digits in the smallest unit`);
  }
  const amount = BigInt(value);
  if (amount <= 0n || amount > MAX_AMOUNT) {
    throw new BadRequestException(`${field} must be between 1 and ${MAX_AMOUNT}`);
  }
  return amount;
}
