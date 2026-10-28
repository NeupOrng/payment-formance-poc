import { add, cmp, div, evaluate, formulaRefs, frac, fromDecimal, fromMinor, mul, parseFormula, toMinorRounded, type Fraction } from './expression.js';

export type AmountRule = {
  amountType: string;
  calcSequence: number;
  calcMethod: 'FIXED' | 'FORMULA';
  baseAmountType: string | null;
  fixedValue: string | null;
  percentage: string | null; // 5 = 5%
  formulaExpression: string | null;
  minValue: string | null;
  maxValue: string | null;
};

const HUNDRED = frac(100n);

/**
 * Checks a tier's rules before they are saved: every amount type exists, calc_sequence is unique,
 * formulas parse, and a rule only uses AMOUNT or amount types calculated earlier.
 */
export function validateRules(rules: AmountRule[], knownTypes: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const ordered = [...rules].sort((a, b) => a.calcSequence - b.calcSequence);
  const available = new Set(['AMOUNT']);
  const seen = new Set<number>();
  for (const r of ordered) {
    const where = `${r.amountType} (sequence ${r.calcSequence})`;
    if (!knownTypes.has(r.amountType)) problems.push(`${where}: unknown amount type`);
    if (r.amountType === 'AMOUNT') problems.push(`${where}: AMOUNT comes from the order and has no rule`);
    if (seen.has(r.calcSequence)) problems.push(`${where}: calc_sequence is used twice`);
    seen.add(r.calcSequence);
    let refs: string[] = [];
    try {
      refs = r.calcMethod === 'FORMULA' ? [...formulaRefs(parseFormula(r.formulaExpression ?? ''))] : r.baseAmountType ? [r.baseAmountType] : [];
    } catch (err) {
      problems.push(`${where}: ${(err as Error).message}`);
    }
    for (const ref of refs) {
      if (!available.has(ref)) problems.push(`${where}: uses ${ref}, which is not AMOUNT or calculated earlier`);
    }
    available.add(r.amountType);
  }
  return problems;
}

/**
 * Calculates every amount type of an order, in calc_sequence order. Each result is clamped to
 * [min_value, max_value] and rounded half up to 2 decimals; later rules see the rounded values.
 * Returns minor units (cents / sen).
 */
export function computeAmounts(amountMinor: bigint, rules: AmountRule[]): Map<string, bigint> {
  const exact = new Map<string, Fraction>([['AMOUNT', fromMinor(amountMinor)]]);
  const result = new Map<string, bigint>([['AMOUNT', amountMinor]]);

  for (const r of [...rules].sort((a, b) => a.calcSequence - b.calcSequence)) {
    let value: Fraction;
    if (r.calcMethod === 'FORMULA') {
      value = evaluate(parseFormula(r.formulaExpression ?? ''), exact);
    } else {
      value = r.fixedValue ? fromDecimal(r.fixedValue) : frac(0n);
      if (r.percentage && r.baseAmountType) {
        const base = exact.get(r.baseAmountType);
        if (!base) throw new Error(`${r.amountType}: ${r.baseAmountType} has no value yet`);
        value = add(value, div(mul(base, fromDecimal(r.percentage)), HUNDRED));
      }
    }
    if (r.minValue && cmp(value, fromDecimal(r.minValue)) < 0) value = fromDecimal(r.minValue);
    if (r.maxValue && cmp(value, fromDecimal(r.maxValue)) > 0) value = fromDecimal(r.maxValue);
    const minor = toMinorRounded(value);
    if (minor < 0n) throw new Error(`${r.amountType} is negative`);
    result.set(r.amountType, minor);
    exact.set(r.amountType, fromMinor(minor));
  }
  return result;
}
