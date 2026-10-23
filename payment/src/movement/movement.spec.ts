import { AMOUNT_TYPES } from '../db/schema.js';
import type { AmountValues, PricingRule } from '../pricing/pricing.js';
import {
  accountAddress,
  amountRange,
  checkBalance,
  planPostings,
  sampleAmounts,
  toNumscript,
  type MovementEntry,
} from './movement.js';

const values = (o: Partial<AmountValues>): AmountValues => ({
  ...(Object.fromEntries(AMOUNT_TYPES.map((t) => [t, 0n])) as AmountValues),
  ...o,
});
const entry = (entryNo: number, side: MovementEntry['side'], account: string, amountType: MovementEntry['amountType'], allowOverdraft = false): MovementEntry => ({
  entryNo,
  side,
  account,
  amountType,
  allowOverdraft,
});
const tier = (o: Partial<PricingRule> & { minAmount?: bigint; maxAmount?: bigint | null }) => ({
  amountType: 'fee_from_customer' as const,
  calcType: 'percent' as const,
  baseAmountType: 'amount' as const,
  includeBase: false,
  fixedAmount: 0n,
  percentBps: 0,
  minValue: null,
  maxValue: null,
  minAmount: 1n,
  maxAmount: null,
  ...o,
});
const noNet = { netAmountAdd: [], netAmountSubtract: [] };
const resolve = (account: string) => ({ '{source}': 'users:a:usd', '{destination}': 'users:b:usd' })[account] ?? accountAddress(account, 'shop', 'USD');

// The example from the spec: ≤ $40, selling price = amount + 5%, fee from customer = 5%.
const exampleEntries = [
  entry(1, 'debit', '{source}', 'selling_price'),
  entry(2, 'credit', '{destination}', 'amount'),
  entry(3, 'credit', 'platform:fees:{service}', 'fee_from_customer'),
];
const exampleTiers = [
  tier({ amountType: 'selling_price', percentBps: 500, includeBase: true, maxAmount: 4_000n }),
  tier({ amountType: 'fee_from_customer', percentBps: 500, maxAmount: 4_000n }),
];

describe('checkBalance', () => {
  it('accepts a movement whose debits equal its credits for every band', () => {
    expect(checkBalance(exampleEntries, exampleTiers, noNet, 4_000n)).toEqual([]);
  });

  it('reports the amounts where debits and credits differ', () => {
    const missingFee = exampleEntries.slice(0, 2);
    const problems = checkBalance(missingFee, exampleTiers, noNet, 4_000n);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.find((p) => p.amount === '1000')).toEqual({ amount: '1000', debit: '1050', credit: '1000' });
  });

  it('only checks amounts inside the configured bands (≤ $40 here)', () => {
    expect(checkBalance(exampleEntries, exampleTiers, noNet, 10_000n)).toEqual([]);
  });

  it('flags a gap between bands where a priced type is missing', () => {
    const withGap = [
      ...exampleTiers,
      tier({ amountType: 'selling_price', percentBps: 500, includeBase: true, minAmount: 6_000n, maxAmount: 8_000n }),
    ];
    // 4,001 – 5,999 is inside the range but has no selling price → debit 0 vs credit = amount.
    expect(checkBalance(exampleEntries, withGap, noNet, 10_000n).some((p) => p.amount === '4001')).toBe(true);
  });
});

describe('sampleAmounts', () => {
  it('includes band edges and stays within the configured range', () => {
    const points = sampleAmounts([{ minAmount: 1n, maxAmount: 4_000n }], 10_000n);
    expect(points).toEqual(expect.arrayContaining([1n, 4_000n, 2_000n]));
    expect(points.every((p) => p <= 4_000n)).toBe(true);
  });

  it('covers the whole range when there are no tiers', () => {
    expect(sampleAmounts([], 10_000n).at(-1)).toBe(10_000n);
  });
});

describe('amountRange', () => {
  it('spans the lowest to the highest band, open-ended if any band is', () => {
    expect(amountRange([{ minAmount: 1_000n, maxAmount: 2_000n }, { minAmount: 1n, maxAmount: 500n }])).toEqual({ min: 1n, max: 2_000n });
    expect(amountRange([{ minAmount: 1n, maxAmount: 500n }, { minAmount: 501n, maxAmount: null }])).toEqual({ min: 1n, max: null });
    expect(amountRange([])).toBeNull();
  });
});

describe('planPostings', () => {
  it('pairs debits with credits into postings, keeping both amount types', () => {
    const { postings, effects } = planPostings(
      exampleEntries,
      values({ selling_price: 1_050n, amount: 1_000n, fee_from_customer: 50n }),
      resolve,
    );
    expect(postings).toEqual([
      { source: 'users:a:usd', destination: 'users:b:usd', amount: '1000', debitType: 'selling_price', creditType: 'amount', overdraft: false },
      { source: 'users:a:usd', destination: 'platform:fees:shop:usd', amount: '50', debitType: 'selling_price', creditType: 'fee_from_customer', overdraft: false },
    ]);
    expect(effects.get('{source}')).toBe(-1_050n);
    expect(effects.get('{destination}')).toBe(1_000n);
  });

  it('chains through an intermediate account in entry order', () => {
    const { postings } = planPostings(
      [
        entry(1, 'debit', '{source}', 'amount'),
        entry(2, 'credit', 'services:{service}', 'amount'),
        entry(3, 'debit', 'services:{service}', 'platform_commission'),
        entry(4, 'credit', 'platform:revenue:{service}', 'platform_commission'),
      ],
      values({ amount: 10_000n, platform_commission: 100n }),
      resolve,
    );
    expect(postings.map((p) => [p.source, p.destination, p.amount])).toEqual([
      ['users:a:usd', 'services:shop:usd', '10000'],
      ['services:shop:usd', 'platform:revenue:shop:usd', '100'],
    ]);
  });

  it('skips zero values and refuses an unbalanced movement', () => {
    expect(() => planPostings(exampleEntries, values({ selling_price: 1_050n, amount: 1_000n }), resolve)).toThrow(/not balanced/);
  });
});

describe('toNumscript', () => {
  it('writes one send per posting, with overdraft only where allowed', () => {
    const plain = toNumscript(
      [
        { source: 'users:a:usd', destination: 'users:b:usd', amount: '1000', debitType: 'amount', creditType: 'amount', overdraft: false },
        { source: 'platform:marketing:usd', destination: 'users:a:usd', amount: '20', debitType: 'cash_back', creditType: 'cash_back', overdraft: true },
      ],
      'USD/2',
    );
    expect(plain).toBe(
      'send [USD/2 1000] (\n  source = @users:a:usd\n  destination = @users:b:usd\n)\n' +
        'send [USD/2 20] (\n  source = @platform:marketing:usd allowing unbounded overdraft\n  destination = @users:a:usd\n)\n',
    );
  });
});
