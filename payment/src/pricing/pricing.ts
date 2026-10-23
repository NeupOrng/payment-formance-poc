import {
  AMOUNT_TYPES,
  type AmountType,
  type BaseAmountType,
  type CalcType,
  type PricedAmountType,
} from '../db/schema.js';

export type PricingRule = {
  id?: string;
  amountType: PricedAmountType;
  calcType: CalcType;
  baseAmountType: BaseAmountType;
  includeBase: boolean;
  fixedAmount: bigint;
  percentBps: number;
  minValue: bigint | null;
  maxValue: bigint | null;
};

export type NetAmountFormula = {
  netAmountAdd: PricedAmountType[];
  netAmountSubtract: PricedAmountType[];
};

export type AmountValues = Record<AmountType, bigint>;

/**
 * (include_base ? base : 0) + clamp(fixed + base × percent_bps / 10,000, min_value, max_value),
 * the percentage rounded half-up. All values in the smallest currency unit.
 * Example: selling_price = amount + amount × 5% → base amount, include_base, 500 bps.
 */
export function ruleValue(base: bigint, rule: PricingRule): bigint {
  let value = 0n;
  if (rule.calcType === 'fixed' || rule.calcType === 'fixed_plus_percent') {
    value += rule.fixedAmount;
  }
  if (rule.calcType === 'percent' || rule.calcType === 'fixed_plus_percent') {
    value += (base * BigInt(rule.percentBps) + 5_000n) / 10_000n;
  }
  if (rule.minValue !== null && value < rule.minValue) value = rule.minValue;
  if (rule.maxValue !== null && value > rule.maxValue) value = rule.maxValue;
  return rule.includeBase ? base + value : value;
}

/**
 * Calculates every amount type for one transaction:
 * - `amount` is the request amount;
 * - priced types come from their rule (0 when no rule applies). Rules based on `amount` run
 *   first, then rules based on another type (one level deep, e.g. VAT = 10% of fee_from_customer);
 * - `net_amount` = amount + Σ(netAmountAdd) − Σ(netAmountSubtract).
 */
export function computeAmounts(
  amount: bigint,
  rules: PricingRule[],
  formula: NetAmountFormula,
): { values: AmountValues; ruleIds: Partial<Record<AmountType, string>> } {
  const values = Object.fromEntries(AMOUNT_TYPES.map((t) => [t, 0n])) as AmountValues;
  const ruleIds: Partial<Record<AmountType, string>> = {};
  values.amount = amount;

  const direct = rules.filter((r) => r.baseAmountType === 'amount');
  const derived = rules.filter((r) => r.baseAmountType !== 'amount');
  const derivedTypes = new Set<AmountType>(derived.map((r) => r.amountType));

  for (const rule of [...direct, ...derived]) {
    if (derivedTypes.has(rule.baseAmountType)) {
      throw new Error(
        `${rule.amountType} is based on ${rule.baseAmountType}, which is itself based on another type`,
      );
    }
    values[rule.amountType] = ruleValue(values[rule.baseAmountType], rule);
    if (rule.id) ruleIds[rule.amountType] = rule.id;
  }

  const sum = (types: PricedAmountType[]) => types.reduce((acc, t) => acc + values[t], 0n);
  values.net_amount = amount + sum(formula.netAmountAdd) - sum(formula.netAmountSubtract);
  if (values.net_amount < 0n) throw new Error('net amount is negative');

  return { values, ruleIds };
}
