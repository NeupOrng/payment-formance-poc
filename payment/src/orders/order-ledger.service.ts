import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { toMinor } from '../common/money.js';
import { DRIZZLE, type Database } from '../db/database.module.js';
import {
  paymentOrderBalanceMovement,
  paymentOrderLedgerTx,
  paymentOrders,
  paymentOrderStatusHistory,
  serviceCommand,
  type LedgerStep,
  type PaymentStatus,
} from '../db/schema.js';
import { LedgerClient, LedgerError } from '../ledger/ledger.client.js';
import type { StepResult } from '../temporal/types.js';

/** Legal status moves; anything else is ignored, which makes retried transitions harmless. */
const ALLOWED: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ['PROCESSING', 'FAILED', 'CANCELLED'],
  PROCESSING: ['COMPLETED', 'FAILED'],
  COMPLETED: ['REVERSED'],
  FAILED: [],
  CANCELLED: [],
  REVERSED: [],
};

/**
 * Saga activities that touch the ledger and the order's status. All idempotent, because Temporal
 * retries an activity until it succeeds:
 * - a ledger step uses reference = Idempotency-Key = `{orderId}:{step}`, so Formance applies it once;
 * - a status change only applies from a status that allows it.
 */
@Injectable()
export class OrderLedgerService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly ledger: LedgerClient,
  ) {}

  /** Posts one planned ledger transaction. Business rejections are results; outages throw (and retry). */
  async postLedgerStep(orderId: string, step: LedgerStep): Promise<StepResult> {
    const [row] = await this.db
      .select()
      .from(paymentOrderLedgerTx)
      .where(and(eq(paymentOrderLedgerTx.paymentOrderId, orderId), eq(paymentOrderLedgerTx.step, step)));
    // Steps that were not planned (e.g. no RESERVE when only bank stocks pay) are no-ops.
    if (!row) return { ok: true, ledgerTxId: null };
    if (row.status === 'POSTED') return { ok: true, ledgerTxId: row.ledgerTxId === null ? null : String(row.ledgerTxId) };
    if (row.status === 'REJECTED') return { ok: false, reason: row.failureReason ?? 'rejected' };

    let ledgerTxId: number | null;
    try {
      ledgerTxId = step === 'REVERT' ? await this.revertSettle(orderId) : await this.post(orderId, step, row.numscript!);
    } catch (err) {
      if (err instanceof LedgerError && err.isRejection) {
        const reason = err.code.toLowerCase().slice(0, 64);
        await this.updateStep(orderId, step, { status: 'REJECTED', failureReason: reason });
        return { ok: false, reason };
      }
      throw err;
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(paymentOrderLedgerTx)
        .set({ status: 'POSTED', ledgerTxId: ledgerTxId === null ? null : BigInt(ledgerTxId), updatedAt: new Date() })
        .where(and(eq(paymentOrderLedgerTx.paymentOrderId, orderId), eq(paymentOrderLedgerTx.step, step)));
      if (step === 'SETTLE' || step === 'REVERT') {
        await tx
          .update(paymentOrderBalanceMovement)
          .set({
            status: step === 'SETTLE' ? 'POSTED' : 'REVERSED',
            ...(step === 'SETTLE' && { coreReference: String(ledgerTxId) }),
            updatedAt: new Date(),
          })
          .where(eq(paymentOrderBalanceMovement.paymentOrderId, orderId));
      }
    });
    return { ok: true, ledgerTxId: ledgerTxId === null ? null : String(ledgerTxId) };
  }

  /**
   * Moves the order to a new status and records it in the history. A finished REFUND / CANCEL that
   * brings the total reversed up to the original amount marks the original order REVERSED.
   */
  async transition(orderId: string, to: PaymentStatus, reason: string | null, changedBy: string) {
    const reasonCode = reason?.slice(0, 20) ?? null; // status_reason_code is VARCHAR(20)
    await this.db.transaction(async (tx) => {
      const [order] = await tx.select().from(paymentOrders).where(eq(paymentOrders.id, orderId)).for('update');
      if (!order) throw new NotFoundException(`order ${orderId} not found`);
      if (order.status === to || !ALLOWED[order.status].includes(to)) return;

      await tx
        .update(paymentOrders)
        .set({ status: to, statusReasonCode: reasonCode, version: sql`${paymentOrders.version} + 1`, updatedAt: new Date() })
        .where(eq(paymentOrders.id, orderId));
      await tx.insert(paymentOrderStatusHistory).values({ paymentOrderId: orderId, fromStatus: order.status, toStatus: to, reasonCode, changedBy });
      if (to === 'FAILED' || to === 'CANCELLED') {
        await tx
          .update(paymentOrderBalanceMovement)
          .set({ status: 'FAILED', updatedAt: new Date() })
          .where(and(eq(paymentOrderBalanceMovement.paymentOrderId, orderId), eq(paymentOrderBalanceMovement.status, 'PENDING')));
      }

      if (to === 'COMPLETED' && order.originalOrderId) {
        const [original] = await tx.select().from(paymentOrders).where(eq(paymentOrders.id, order.originalOrderId)).for('update');
        const [done] = await tx
          .select({ total: sql<string>`coalesce(sum(${paymentOrders.amount}), 0)::text` })
          .from(paymentOrders)
          .where(and(eq(paymentOrders.originalOrderId, original.id), eq(paymentOrders.status, 'COMPLETED')));
        const fully = toMinor(done.total) + toMinor(order.amount) >= toMinor(original.amount);
        if (fully && original.status === 'COMPLETED') {
          const [cmd] = await tx.select().from(serviceCommand).where(eq(serviceCommand.id, order.serviceCommandId));
          const reason = cmd.commandType === 'CANCEL' ? 'CANCELLED' : 'FULLY_REFUNDED';
          await tx
            .update(paymentOrders)
            .set({ status: 'REVERSED', statusReasonCode: reason, version: sql`${paymentOrders.version} + 1`, updatedAt: new Date() })
            .where(eq(paymentOrders.id, original.id));
          await tx.insert(paymentOrderStatusHistory).values({
            paymentOrderId: original.id,
            fromStatus: 'COMPLETED',
            toStatus: 'REVERSED',
            reasonCode: reason,
            changedBy: 'SYSTEM',
          });
        }
      }
    });
  }

  private async post(orderId: string, step: LedgerStep, numscript: string) {
    const reference = `${orderId}:${step.toLowerCase()}`;
    try {
      const tx = await this.ledger.createTransaction(
        { script: { plain: numscript, vars: {} }, reference, metadata: { order_id: orderId, step } },
        reference,
      );
      return tx.id;
    } catch (err) {
      if (err instanceof LedgerError && err.code === 'CONFLICT') {
        // Posted by an earlier attempt whose response was lost.
        const existing = await this.ledger.findTransactionByReference(reference);
        if (existing) return existing.id;
      }
      throw err;
    }
  }

  /** Compensation for SETTLE: Formance's revert writes the opposite postings as a new transaction. */
  private async revertSettle(orderId: string) {
    const [settle] = await this.db
      .select({ ledgerTxId: paymentOrderLedgerTx.ledgerTxId })
      .from(paymentOrderLedgerTx)
      .where(and(eq(paymentOrderLedgerTx.paymentOrderId, orderId), eq(paymentOrderLedgerTx.step, 'SETTLE')));
    if (!settle?.ledgerTxId) return null; // nothing was settled
    return (await this.ledger.revertTransaction(Number(settle.ledgerTxId))).id;
  }

  private updateStep(orderId: string, step: LedgerStep, values: Partial<typeof paymentOrderLedgerTx.$inferInsert>) {
    return this.db
      .update(paymentOrderLedgerTx)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(paymentOrderLedgerTx.paymentOrderId, orderId), eq(paymentOrderLedgerTx.step, step)));
  }
}

