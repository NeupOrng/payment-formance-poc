import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/database.module.js';
import { ledgerOutbox, transferEvents, transfers } from '../db/schema.js';
import { LedgerClient, LedgerError } from '../ledger/ledger.client.js';

type OutboxRow = typeof ledgerOutbox.$inferSelect;

const LEASE = sql`now() + interval '30 seconds'`;
const MAX_ATTEMPTS = 10;

/**
 * Sends queued transfers to Formance and records the outcome.
 * A row is "leased" for 30s before posting so the request path and the worker never post it at the
 * same time; Idempotency-Key = transfer id makes a repeated post return the original transaction.
 */
@Injectable()
export class LedgerPoster {
  private readonly logger = new Logger(LedgerPoster.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly ledger: LedgerClient,
  ) {}

  /** Tries to post one transfer right away (called from the request path). */
  async postNow(transferId: string) {
    const [row] = await this.db
      .update(ledgerOutbox)
      .set({ attempts: sql`${ledgerOutbox.attempts} + 1`, nextAttemptAt: LEASE, updatedAt: new Date() })
      .where(
        and(
          eq(ledgerOutbox.transferId, transferId),
          eq(ledgerOutbox.status, 'queued'),
          lte(ledgerOutbox.nextAttemptAt, sql`now()`),
        ),
      )
      .returning();
    if (row) await this.attempt(row);
  }

  /** Posts every due outbox row (called by the worker). Returns how many were attempted. */
  async processDue(batchSize = 20) {
    const due = this.db
      .select({ id: ledgerOutbox.id })
      .from(ledgerOutbox)
      .where(and(eq(ledgerOutbox.status, 'queued'), lte(ledgerOutbox.nextAttemptAt, sql`now()`)))
      .orderBy(asc(ledgerOutbox.nextAttemptAt))
      .limit(batchSize)
      .for('update', { skipLocked: true });

    const rows = await this.db
      .update(ledgerOutbox)
      .set({ attempts: sql`${ledgerOutbox.attempts} + 1`, nextAttemptAt: LEASE, updatedAt: new Date() })
      .where(inArray(ledgerOutbox.id, due))
      .returning();

    for (const row of rows) await this.attempt(row);
    return rows.length;
  }

  private async attempt(row: OutboxRow) {
    try {
      const tx = await this.ledger.createTransaction(row.request, row.transferId);
      await this.markPosted(row, tx.id);
    } catch (err) {
      if (err instanceof LedgerError && err.code === 'CONFLICT') {
        // The reference already exists: an earlier attempt succeeded but its response was lost.
        const existing = await this.ledger.findTransactionByReference(row.transferId).catch(() => null);
        if (existing) return this.markPosted(row, existing.id);
      }
      if (err instanceof LedgerError && err.isRejection) {
        return this.markFailed(row, err.code.toLowerCase(), err.message);
      }
      await this.scheduleRetry(row, (err as Error).message);
    }
  }

  private async markPosted(row: OutboxRow, ledgerTxId: number) {
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(transfers)
        .set({ status: 'posted', ledgerTxId: BigInt(ledgerTxId), updatedAt: new Date() })
        .where(and(eq(transfers.id, row.transferId), eq(transfers.status, 'pending')))
        .returning({ id: transfers.id });
      if (updated.length) {
        await tx.insert(transferEvents).values({
          transferId: row.transferId,
          fromStatus: 'pending',
          toStatus: 'posted',
          reason: `ledger tx ${ledgerTxId}`,
        });
      }
      await tx
        .update(ledgerOutbox)
        .set({ status: 'done', lastError: null, updatedAt: new Date() })
        .where(eq(ledgerOutbox.id, row.id));
    });
  }

  private async markFailed(row: OutboxRow, reason: string, detail: string) {
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(transfers)
        .set({ status: 'failed', failureReason: reason, updatedAt: new Date() })
        .where(and(eq(transfers.id, row.transferId), eq(transfers.status, 'pending')))
        .returning({ id: transfers.id });
      if (updated.length) {
        await tx.insert(transferEvents).values({
          transferId: row.transferId,
          fromStatus: 'pending',
          toStatus: 'failed',
          reason,
        });
      }
      await tx
        .update(ledgerOutbox)
        .set({ status: 'done', lastError: detail, updatedAt: new Date() })
        .where(eq(ledgerOutbox.id, row.id));
    });
  }

  private async scheduleRetry(row: OutboxRow, error: string) {
    const dead = row.attempts >= MAX_ATTEMPTS;
    const delaySeconds = Math.min(2 ** row.attempts, 300);
    await this.db
      .update(ledgerOutbox)
      .set({
        status: dead ? 'dead' : 'queued',
        lastError: error,
        nextAttemptAt: sql`now() + make_interval(secs => ${delaySeconds})`,
        updatedAt: new Date(),
      })
      .where(eq(ledgerOutbox.id, row.id));
    if (dead) {
      this.logger.error(`Transfer ${row.transferId} gave up after ${row.attempts} attempts: ${error}`);
    } else {
      this.logger.warn(`Transfer ${row.transferId} attempt ${row.attempts} failed, retrying in ${delaySeconds}s: ${error}`);
    }
  }
}
