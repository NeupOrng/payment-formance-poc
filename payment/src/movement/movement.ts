import type { AmountType, EntrySide, PlannedPosting } from '../db/schema.js';
import { computeAmounts, type AmountValues, type NetAmountFormula, type PricingRule } from '../pricing/pricing.js';

export type MovementEntry = {
  entryNo: number;
  side: EntrySide;
  account: string;
  amountType: AmountType;
  allowOverdraft: boolean;
};

/** Σ debits and Σ credits of a movement for one set of calculated values. */
export function totals(entries: MovementEntry[], values: AmountValues) {
  let debit = 0n;
  let credit = 0n;
  for (const e of entries) {
    if (e.side === 'debit') debit += values[e.amountType];
    else credit += values[e.amountType];
  }
  return { debit, credit };
}

type Band = { minAmount: bigint; maxAmount: bigint | null };

/**
 * The request amounts a command accepts in one currency: from its lowest band to its highest
 * (open-ended if any band is). No tiers → any amount.
 */
export function amountRange(bands: Band[]): { min: bigint; max: bigint | null } | null {
  if (!bands.length) return null;
  const min = bands.reduce((m, b) => (b.minAmount < m ? b.minAmount : m), bands[0].minAmount);
  const max = bands.some((b) => b.maxAmount === null)
    ? null
    : bands.reduce((m, b) => (b.maxAmount! > m ? b.maxAmount! : m), 0n);
  return { min: min > 0n ? min : 1n, max };
}

/**
 * Request amounts worth testing for one currency: each band's edges and middle, plus a spread
 * of round numbers. A movement that balances at all of them balances for the configured rules.
 */
export function sampleAmounts(rules: Band[], max: bigint): bigint[] {
  const points = new Set<bigint>([1n, 99n, 12_345n]);
  for (let p = 1n; p <= max; p *= 10n) points.add(p);
  for (const r of rules) {
    const lo = r.minAmount > 0n ? r.minAmount : 1n;
    points.add(lo);
    if (lo > 1n) points.add(lo - 1n);
    if (r.maxAmount !== null) {
      points.add(r.maxAmount);
      points.add(r.maxAmount + 1n);
      points.add((lo + r.maxAmount) / 2n);
    } else {
      points.add(lo * 10n);
    }
  }
  const range = amountRange(rules);
  const lo = range?.min ?? 1n;
  const hi = range?.max !== null && range?.max !== undefined && range.max < max ? range.max : max;
  return [...points].filter((p) => p >= lo && p <= hi).sort((a, b) => (a < b ? -1 : 1));
}

export type BalanceProblem = { amount: string; debit: string; credit: string };

/**
 * Checks that a movement balances (Σ debits = Σ credits) for every sampled request amount within
 * the command's amount range, using the pricing rules of one currency. Returns the amounts where
 * it does not.
 */
export function checkBalance(
  entries: MovementEntry[],
  rules: (PricingRule & { minAmount: bigint; maxAmount: bigint | null })[],
  formula: NetAmountFormula,
  max: bigint,
): BalanceProblem[] {
  const problems: BalanceProblem[] = [];
  for (const amount of sampleAmounts(rules, max)) {
    const applicable = rules.filter(
      (r) => r.minAmount <= amount && (r.maxAmount === null || amount <= r.maxAmount),
    );
    const { values } = computeAmounts(amount, applicable, formula);
    const { debit, credit } = totals(entries, values);
    if (debit !== credit) {
      problems.push({ amount: amount.toString(), debit: debit.toString(), credit: credit.toString() });
    }
  }
  return problems;
}

type Resolved = { address: string; amountType: AmountType; value: bigint; overdraft: boolean };

/**
 * Pairs debits with credits, in entry order, into source → destination postings.
 * Example: debit payer 105 (selling price); credit payee 100 (amount), credit fee account 5 (fee)
 *   → payer → payee 100, payer → fee account 5.
 * A debit and a credit of the same account cancel out and produce no posting.
 */
export function planPostings(
  entries: MovementEntry[],
  values: AmountValues,
  resolve: (account: string) => string,
): { postings: (PlannedPosting & { overdraft: boolean })[]; effects: Map<string, bigint> } {
  const effects = new Map<string, bigint>();
  const debits: Resolved[] = [];
  const credits: Resolved[] = [];

  for (const e of [...entries].sort((a, b) => a.entryNo - b.entryNo)) {
    const value = values[e.amountType];
    if (value === 0n) continue;
    if (value < 0n) throw new Error(`${e.amountType} is negative`);
    const r = { address: resolve(e.account), amountType: e.amountType, value, overdraft: e.allowOverdraft };
    (e.side === 'debit' ? debits : credits).push(r);
    effects.set(e.account, (effects.get(e.account) ?? 0n) + (e.side === 'credit' ? value : -value));
  }

  const debitTotal = debits.reduce((s, d) => s + d.value, 0n);
  const creditTotal = credits.reduce((s, c) => s + c.value, 0n);
  if (debitTotal !== creditTotal) {
    throw new Error(`movement is not balanced: debits ${debitTotal} ≠ credits ${creditTotal}`);
  }
  if (debitTotal === 0n) throw new Error('movement moves nothing');

  const postings: (PlannedPosting & { overdraft: boolean })[] = [];
  let d = 0;
  let c = 0;
  let debitLeft = debits[0]?.value ?? 0n;
  let creditLeft = credits[0]?.value ?? 0n;
  while (d < debits.length && c < credits.length) {
    const amount = debitLeft < creditLeft ? debitLeft : creditLeft;
    const from = debits[d];
    const to = credits[c];
    if (from.address !== to.address) {
      postings.push({
        source: from.address,
        destination: to.address,
        amount: amount.toString(),
        debitType: from.amountType,
        creditType: to.amountType,
        overdraft: from.overdraft,
      });
    }
    debitLeft -= amount;
    creditLeft -= amount;
    if (debitLeft === 0n && ++d < debits.length) debitLeft = debits[d].value;
    if (creditLeft === 0n && ++c < credits.length) creditLeft = credits[c].value;
  }
  return { postings, effects };
}

/** One Numscript `send` per planned posting, so ledger posting N = planned posting N. */
export function toNumscript(postings: (PlannedPosting & { overdraft: boolean })[], asset: string): string {
  return postings
    .map(
      (p) =>
        `send [${asset} ${p.amount}] (\n  source = @${p.source}${p.overdraft ? ' allowing unbounded overdraft' : ''}\n  destination = @${p.destination}\n)\n`,
    )
    .join('');
}

/** Replaces `{service}` and appends the currency to a specific account path. */
export function accountAddress(path: string, serviceCode: string, currency: string) {
  return `${path.replaceAll('{service}', serviceCode.toLowerCase())}:${currency.toLowerCase()}`;
}
