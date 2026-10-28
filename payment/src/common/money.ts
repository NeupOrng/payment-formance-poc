import { BadRequestException } from '@nestjs/common';
import type { Currency } from '../db/schema.js';

/** Formance asset per currency: both have 2 decimals, so 1 minor unit = 0.01. */
export const assetFor = (currency: string) => `${currency}/2`;

// Formance returns amounts as JSON numbers, so stay within the exact integer range of a double.
export const MAX_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

const DECIMAL = /^\d+(\.\d{1,2})?$/;

/** "21.5" → 2150n. Amounts in the API and in NUMERIC(20,2) columns are decimal strings. */
export function toMinor(value: string): bigint {
  if (!DECIMAL.test(value)) throw new Error(`not a decimal amount with at most 2 decimals: ${value}`);
  const [whole, frac = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
}

/** 2150n → "21.50". */
export function toDecimal(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** Parses a request amount: positive, at most 2 decimals, within the ledger's exact range. */
export function parseAmount(value: string, field = 'amount'): bigint {
  if (!DECIMAL.test(value)) throw new BadRequestException(`${field} must be a decimal string with at most 2 decimals, e.g. "21.50"`);
  const minor = toMinor(value);
  if (minor <= 0n || minor > MAX_MINOR) throw new BadRequestException(`${field} must be greater than 0`);
  return minor;
}

export type { Currency };
