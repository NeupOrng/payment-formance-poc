import { computeAmounts, ruleValue, type PricingRule } from './pricing.js';

const rule = (overrides: Partial<PricingRule>): PricingRule => ({
  amountType: 'fee_from_customer',
  calcType: 'fixed',
  baseAmountType: 'amount',
  includeBase: false,
  fixedAmount: 0n,
  percentBps: 0,
  minValue: null,
  maxValue: null,
  ...overrides,
});
const noNet = { netAmountAdd: [], netAmountSubtract: [] };

describe('ruleValue', () => {
  it('charges a fixed value', () => {
    expect(ruleValue(10_000n, rule({ fixedAmount: 25n }))).toBe(25n);
  });

  it('rounds percentages half-up', () => {
    const r = rule({ calcType: 'percent', percentBps: 25 });
    expect(ruleValue(10_002n, r)).toBe(25n);
    expect(ruleValue(10_200n, r)).toBe(26n);
  });

  it('adds fixed and percent parts and clamps to min/max', () => {
    expect(ruleValue(5_000n, rule({ calcType: 'fixed_plus_percent', fixedAmount: 10n, percentBps: 100 }))).toBe(60n);
    const clamped = rule({ calcType: 'percent', percentBps: 25, minValue: 30n, maxValue: 500n });
    expect(ruleValue(100n, clamped)).toBe(30n);
    expect(ruleValue(1_000_000n, clamped)).toBe(500n);
  });

  it('adds the base itself when includeBase is set (selling price = amount + 5%)', () => {
    const r = rule({ amountType: 'selling_price', calcType: 'percent', percentBps: 500, includeBase: true, maxValue: 100n });
    expect(ruleValue(1_000n, r)).toBe(1_050n);
    expect(ruleValue(4_000n, r)).toBe(4_100n); // only the added part is clamped
  });

  it('stays exact for very large amounts', () => {
    expect(ruleValue(9_007_199_254_740_991n, rule({ calcType: 'percent', percentBps: 1 }))).toBe(900_719_925_474n);
  });
});

describe('computeAmounts', () => {
  it('sets amount, leaves unpriced types at 0', () => {
    const { values } = computeAmounts(10_000n, [], noNet);
    expect(values.amount).toBe(10_000n);
    expect(values.vat).toBe(0n);
    expect(values.net_amount).toBe(10_000n);
  });

  it('computes rules based on another type after the ones based on amount', () => {
    const { values, ruleIds } = computeAmounts(
      10_000n,
      [
        rule({ id: 'vat-rule', amountType: 'vat', calcType: 'percent', percentBps: 1_000, baseAmountType: 'fee_from_customer' }),
        rule({ id: 'fee-rule', amountType: 'fee_from_customer', fixedAmount: 25n }),
      ],
      noNet,
    );
    expect(values.fee_from_customer).toBe(25n);
    expect(values.vat).toBe(3n); // 10% of 25 = 2.5 → 3
    expect(ruleIds).toEqual({ fee_from_customer: 'fee-rule', vat: 'vat-rule' });
  });

  it('derives net amount from the command formula', () => {
    const { values } = computeAmounts(
      10_000n,
      [
        rule({ amountType: 'platform_commission', calcType: 'percent', percentBps: 100 }),
        rule({ amountType: 'cash_back', fixedAmount: 50n }),
      ],
      { netAmountAdd: ['cash_back'], netAmountSubtract: ['platform_commission'] },
    );
    expect(values.net_amount).toBe(10_000n - 100n + 50n);
  });

  it('rejects a negative net amount', () => {
    expect(() =>
      computeAmounts(100n, [rule({ amountType: 'discount', fixedAmount: 500n })], {
        netAmountAdd: [],
        netAmountSubtract: ['discount'],
      }),
    ).toThrow(/negative/);
  });

  it('rejects a base that is itself derived', () => {
    expect(() =>
      computeAmounts(
        10_000n,
        [
          rule({ amountType: 'vat', calcType: 'percent', percentBps: 1_000, baseAmountType: 'fee_from_customer' }),
          rule({ amountType: 'fee_from_customer', calcType: 'percent', percentBps: 100, baseAmountType: 'selling_price' }),
        ],
        noNet,
      ),
    ).toThrow(/itself based/);
  });
});
