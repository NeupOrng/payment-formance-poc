import { toDecimal, toMinor } from '../common/money.js';
import type { LedgerStep, PlannedPosting, StockRole } from '../db/schema.js';

export type MovementConfig = {
  movementSequence: number;
  amountType: string;
  fromStockRole: StockRole;
  fromStockId: string | null;
  toStockRole: StockRole;
  toStockId: string | null;
};

export type ResolvedMovement = {
  movementSequence: number;
  amountType: string;
  amount: bigint; // minor units
  fromStockId: string;
  toStockId: string;
};

/** What the engine needs to know about a stock to post (from the Profile Service). */
export type StockInfo = {
  id: string;
  stockNumber: string;
  ledgerAccount: string;
  productType: string;
};

/**
 * Turns a tier's movement config into this order's stock-to-stock movements: PAYER / PAYEE become the
 * order's stocks, SPECIFIC keeps the configured stock. Movements whose amount type came out 0 (or has
 * no rule) are skipped — the schema only stores positive movements. Every movement balances itself
 * (one amount from one stock to another), so the whole order always balances.
 */
export function resolveMovements(
  configs: MovementConfig[],
  amounts: ReadonlyMap<string, bigint>,
  parties: { payer: string; payee: string },
): ResolvedMovement[] {
  const pick = (role: StockRole, specific: string | null) =>
    role === 'PAYER' ? parties.payer : role === 'PAYEE' ? parties.payee : specific!;
  return [...configs]
    .sort((a, b) => a.movementSequence - b.movementSequence)
    .map((c) => ({
      movementSequence: c.movementSequence,
      amountType: c.amountType,
      amount: amounts.get(c.amountType) ?? 0n,
      fromStockId: pick(c.fromStockRole, c.fromStockId),
      toStockId: pick(c.toStockRole, c.toStockId),
    }))
    .filter((m) => {
      if (m.amount > 0n && m.fromStockId === m.toStockId) {
        throw new Error(`movement ${m.movementSequence} would move ${m.amountType} from a stock to itself`);
      }
      return m.amount > 0n;
    });
}

export type PlannedLedgerTx = { step: LedgerStep; postings: PlannedPosting[]; numscript: string | null };

/** Hold accounts are per stock and order, so a stock's hold_amount is the sum under `holds:{stockNumber}:`. */
export const holdAccount = (stockNumber: string, orderId: string) => `holds:${stockNumber}:${orderId}`;

/**
 * Plans the Formance transactions of an order's saga.
 *
 * - RESERVE: money leaving the customer-facing stocks (payer / payee, unless they are INTERNAL bank
 *   accounts) moves into per-order hold accounts, so it can't be spent twice while the order waits for
 *   authorization or SPIs.
 * - SETTLE: the movements, in sequence, paid from those holds. INTERNAL (bank) stocks may go negative
 *   (e.g. the settlement / nostro account on cash-in), customer and agent stocks never.
 * - RELEASE: compensation for RESERVE — the holds go back.
 * - REVERT: compensation for SETTLE, posted with Formance's revert (no script); planned postings are
 *   the mirror of SETTLE for display.
 */
export function planLedger(
  movements: ResolvedMovement[],
  stocks: ReadonlyMap<string, StockInfo>,
  heldStockIds: ReadonlySet<string>,
  orderId: string,
  asset: string,
): PlannedLedgerTx[] {
  const info = (id: string) => {
    const s = stocks.get(id);
    if (!s) throw new Error(`unknown stock ${id}`);
    return s;
  };

  const reserved = new Map<string, bigint>();
  for (const m of movements) {
    if (heldStockIds.has(m.fromStockId)) reserved.set(m.fromStockId, (reserved.get(m.fromStockId) ?? 0n) + m.amount);
  }

  const reserve: PlannedPosting[] = [...reserved].map(([stockId, amount]) => ({
    source: info(stockId).ledgerAccount,
    destination: holdAccount(info(stockId).stockNumber, orderId),
    amount: toDecimal(amount),
    fromStockId: stockId,
    toStockId: null,
    amountType: null,
    movementSequence: null,
  }));

  const settle: PlannedPosting[] = movements.map((m) => {
    const from = info(m.fromStockId);
    const held = heldStockIds.has(m.fromStockId);
    return {
      source: held ? holdAccount(from.stockNumber, orderId) : from.ledgerAccount,
      destination: info(m.toStockId).ledgerAccount,
      amount: toDecimal(m.amount),
      fromStockId: m.fromStockId,
      toStockId: m.toStockId,
      amountType: m.amountType,
      movementSequence: m.movementSequence,
      overdraft: !held && from.productType === 'INTERNAL',
    };
  });

  const release: PlannedPosting[] = reserve.map((r) => ({
    ...r,
    source: r.destination,
    destination: r.source,
    fromStockId: null,
    toStockId: r.fromStockId,
  }));

  const revert: PlannedPosting[] = [...settle].reverse().map((p) => ({
    ...p,
    source: p.destination,
    destination: p.source,
    fromStockId: p.toStockId,
    toStockId: p.fromStockId,
    overdraft: false,
  }));

  const tx = (step: LedgerStep, postings: PlannedPosting[], script = true): PlannedLedgerTx => ({
    step,
    postings,
    numscript: script ? toNumscript(postings, asset) : null,
  });
  return [
    ...(reserve.length ? [tx('RESERVE', reserve), tx('RELEASE', release)] : []),
    tx('SETTLE', settle),
    tx('REVERT', revert, false),
  ];
}

/** One Numscript `send` per posting, so ledger posting N = planned posting N. */
export function toNumscript(postings: PlannedPosting[], asset: string): string {
  return postings
    .map(
      (p) =>
        `send [${asset} ${toMinor(p.amount)}] (\n  source = @${p.source}${p.overdraft ? ' allowing unbounded overdraft' : ''}\n  destination = @${p.destination}\n)\n`,
    )
    .join('');
}
