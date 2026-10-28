import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { minorToDecimal } from '../common/money.js';
import { DRIZZLE, type Database } from '../db/database.module.js';
import { stock } from '../db/schema.js';
import { LedgerReader } from './ledger-reader.js';

/** Hold accounts are `holds:{stockNumber}:{orderId}`, one per payment order still in progress. */
export const holdPrefix = (stockNumber: string) => `holds:${stockNumber}:`;
const HOLD_ADDRESS = /^holds:([^:]+):/;

/**
 * Keeps stock.ledger_balance / hold_amount in step with Formance. Values are always recomputed
 * from the ledger (never incremented), so duplicate or out-of-order events are harmless.
 *   hold_amount    = Σ balances of the stock's hold accounts
 *   ledger_balance = stock account balance + hold_amount (held money is still the owner's)
 *   available      = ledger_balance − hold_amount (generated column) = what the owner can spend
 */
@Injectable()
export class LedgerSyncService {
  private readonly logger = new Logger(LedgerSyncService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly ledger: LedgerReader,
  ) {}

  /** Refreshes every stock touched by these ledger addresses (stock accounts or their holds). */
  async refreshAddresses(addresses: string[]) {
    const holds = addresses.map((a) => HOLD_ADDRESS.exec(a)?.[1]).filter((n): n is string => !!n);
    const rows = await this.db
      .select({ id: stock.id })
      .from(stock)
      .where(
        sql`${inArray(stock.ledgerAccount, addresses.length ? addresses : [''])} OR ${inArray(
          stock.stockNumber,
          holds.length ? holds : [''],
        )}`,
      );
    for (const row of rows) await this.refresh(row.id);
    return rows.length;
  }

  async refresh(stockId: string) {
    const [s] = await this.db.select().from(stock).where(eq(stock.id, stockId));
    if (!s) throw new NotFoundException('stock not found');
    const asset = `${s.currency}/2`;
    const [available, held] = await Promise.all([
      this.ledger.balance(s.ledgerAccount, asset),
      this.ledger.balanceUnder(holdPrefix(s.stockNumber), asset),
    ]);
    const [updated] = await this.db
      .update(stock)
      .set({
        ledgerBalance: minorToDecimal(available + held),
        holdAmount: minorToDecimal(held),
        version: sql`${stock.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(stock.id, stockId))
      .returning();
    this.logger.debug(`stock ${s.stockNumber}: ledger ${updated.ledgerBalance}, hold ${updated.holdAmount}`);
    return updated;
  }
}
