import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, desc, eq, notInArray, or, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { CatalogService } from '../catalog/catalog.service.js';
import { assetFor, parseAmount, toDecimal, toMinor } from '../common/money.js';
import { pgError } from '../common/pg-errors.js';
import { DRIZZLE, type Database } from '../db/database.module.js';
import {
  ledgerStep,
  paymentOrderAmount,
  paymentOrderBalanceMovement,
  paymentOrderLedgerTx,
  paymentOrders,
  paymentOrderStatusHistory,
  service,
  serviceCommand,
  type PaymentOrder,
} from '../db/schema.js';
import { LedgerClient } from '../ledger/ledger.client.js';
import { planLedger, resolveMovements, type StockInfo } from '../movement/movement.js';
import { canPay, canReceive, ProfileClient, type StockView } from '../profile/profile.client.js';
import { workflowIdFor, type OrderInput, type PreparedOrder } from '../temporal/types.js';
import type { ListOrdersQuery } from './dto.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const AUTH_TIMEOUT_SECONDS = Number(process.env.AUTH_TIMEOUT_SECONDS ?? 300);

/** Customer-facing reference, e.g. PO20261028-K3M9Q2A7XW. */
const orderReference = () =>
  `PO${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(6).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, 'X').slice(0, 10)}`;

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly catalog: CatalogService,
    private readonly profiles: ProfileClient,
    private readonly ledger: LedgerClient,
  ) {}

  /**
   * The saga's first activity: validates the order, matches the tier, prices every amount type,
   * resolves the balance movements and plans the ledger transactions, then records it all as one
   * PENDING order. Idempotent: an order that already exists for (customer, key) is returned as is.
   */
  async prepare(input: OrderInput): Promise<PreparedOrder> {
    const existing = await this.findByKey(input.customerId, input.idempotencyKey);
    if (existing) return this.prepared(existing);

    const { service: svc, command: cmd } = await this.catalog.resolveForOrder(input.serviceCode, input.commandType);
    const original = input.commandType === 'PAYMENT' ? null : await this.originalFor(input, svc.id);
    const parties = original
      ? await this.stocks(original.payerAccountId, original.payeeAccountId)
      : await this.paymentParties(input, svc.currency);

    try {
      await this.db.transaction(async (tx) => {
        const amount = original ? await this.reversalAmount(tx, input, original) : parseAmount(input.amount ?? '');
        const { tier, rules, movements: configs } = await this.catalog.matchTier(tx, cmd, amount);
        const values = this.catalog.amountsFor(amount, rules);
        const movements = this.unprocessable(() => resolveMovements(configs, values, { payer: parties.payer.id, payee: parties.payee.id }));

        const specific = await this.profiles.stocks(configs.flatMap((c) => [c.fromStockId, c.toStockId]).filter((id): id is string => !!id));
        const all = [parties.payer, parties.payee, ...specific];
        for (const s of specific) {
          if (s.currency !== svc.currency) throw new UnprocessableEntityException(`stock ${s.stockNumber} is not in ${svc.currency}`);
          if (!canReceive(s)) throw new UnprocessableEntityException(`stock ${s.stockNumber} is closed`);
        }
        const stockInfo = new Map<string, StockInfo>(
          all.map((s) => [s.id, { id: s.id, stockNumber: s.stockNumber, ledgerAccount: s.ledgerAccount, productType: s.account.productType }]),
        );
        // Customer-facing stocks are reserved first; the bank's own (INTERNAL) stocks are not.
        const held = new Set([parties.payer, parties.payee].filter((s) => s.account.productType !== 'INTERNAL').map((s) => s.id));
        const plan = this.unprocessable(() => planLedger(movements, stockInfo, held, input.orderId, assetFor(svc.currency)));

        await tx.insert(paymentOrders).values({
          id: input.orderId,
          orderReference: orderReference(),
          idempotencyKey: input.idempotencyKey,
          externalReference: input.externalReference ?? original?.externalReference ?? null,
          serviceId: svc.id,
          serviceCommandId: cmd.id,
          tierConfigId: tier.id,
          originalOrderId: original?.id ?? null,
          customerId: input.customerId,
          payerAccountId: parties.payer.id,
          payerName: parties.payer.profile.fullName,
          payeeAccountId: parties.payee.id,
          payeeName: parties.payee.profile.fullName,
          amount: toDecimal(amount),
          currency: svc.currency,
        });
        await tx.insert(paymentOrderAmount).values(
          [...values].filter(([type, v]) => type === 'AMOUNT' || v > 0n).map(([type, v]) => ({ paymentOrderId: input.orderId, amountType: type, amount: toDecimal(v) })),
        );
        if (movements.length) {
          await tx.insert(paymentOrderBalanceMovement).values(
            movements.map((m) => ({ ...m, paymentOrderId: input.orderId, amount: toDecimal(m.amount) })),
          );
        }
        await tx.insert(paymentOrderLedgerTx).values(plan.map((t) => ({ paymentOrderId: input.orderId, ...t })));
        await tx.insert(paymentOrderStatusHistory).values({ paymentOrderId: input.orderId, toStatus: 'PENDING', changedBy: 'SYSTEM' });
      });
    } catch (err) {
      if (pgError(err)?.constraint === 'uq_idempotency') {
        const again = await this.findByKey(input.customerId, input.idempotencyKey);
        if (again) return this.prepared(again);
      }
      throw err;
    }
    const [order] = await this.db.select().from(paymentOrders).where(eq(paymentOrders.id, input.orderId));
    return this.prepared(order, parties.payer);
  }

  async get(id: string) {
    const order = await this.find(id);
    if (!order) throw new NotFoundException('payment order not found');
    const [amounts, movements, ledgerTxs, history, [svc]] = await Promise.all([
      this.db.select({ amountType: paymentOrderAmount.amountType, amount: paymentOrderAmount.amount }).from(paymentOrderAmount).where(eq(paymentOrderAmount.paymentOrderId, id)),
      this.db.select().from(paymentOrderBalanceMovement).where(eq(paymentOrderBalanceMovement.paymentOrderId, id)).orderBy(asc(paymentOrderBalanceMovement.movementSequence)),
      this.db
        .select({ step: paymentOrderLedgerTx.step, status: paymentOrderLedgerTx.status, ledgerTxId: paymentOrderLedgerTx.ledgerTxId, failureReason: paymentOrderLedgerTx.failureReason })
        .from(paymentOrderLedgerTx)
        .where(eq(paymentOrderLedgerTx.paymentOrderId, id)),
      this.db.select().from(paymentOrderStatusHistory).where(eq(paymentOrderStatusHistory.paymentOrderId, id)).orderBy(asc(paymentOrderStatusHistory.id)),
      this.db
        .select({ code: service.code, name: service.name, commandType: serviceCommand.commandType })
        .from(service)
        .innerJoin(serviceCommand, eq(serviceCommand.id, order.serviceCommandId))
        .where(eq(service.id, order.serviceId)),
    ]);
    return {
      ...order,
      serviceCode: svc.code,
      serviceName: svc.name,
      commandType: svc.commandType,
      workflowId: workflowIdFor(order.customerId, order.idempotencyKey),
      amounts,
      movements,
      ledgerTransactions: ledgerTxs.sort((a, b) => ledgerStep.enumValues.indexOf(a.step) - ledgerStep.enumValues.indexOf(b.step)),
      history,
    };
  }

  find(id: string): Promise<PaymentOrder | undefined> {
    return this.db.select().from(paymentOrders).where(eq(paymentOrders.id, id)).then((r) => r[0]);
  }

  /** Orders of a customer (as payer) or of a stock (paying or receiving); with a stock, its net effect. */
  async list(query: ListOrdersQuery) {
    if (!query.customerId && !query.stockId) throw new BadRequestException('customerId or stockId is required');
    const net = query.stockId
      ? sql<string>`coalesce((select sum(case when m.to_stock_id = ${query.stockId} then m.amount else 0 end) - sum(case when m.from_stock_id = ${query.stockId} then m.amount else 0 end)
          from payment_order_balance_movement m where m.payment_order_id = ${paymentOrders.id}), 0)::numeric(20,2)::text`
      : sql<null>`null`;
    return this.db
      .select({
        order: paymentOrders,
        serviceCode: service.code,
        serviceName: service.name,
        commandType: serviceCommand.commandType,
        netForStock: net,
      })
      .from(paymentOrders)
      .innerJoin(service, eq(service.id, paymentOrders.serviceId))
      .innerJoin(serviceCommand, eq(serviceCommand.id, paymentOrders.serviceCommandId))
      .where(
        and(
          query.customerId ? eq(paymentOrders.customerId, query.customerId) : undefined,
          query.stockId ? or(eq(paymentOrders.payerAccountId, query.stockId), eq(paymentOrders.payeeAccountId, query.stockId)) : undefined,
          query.status ? eq(paymentOrders.status, query.status) : undefined,
          query.commandType ? eq(serviceCommand.commandType, query.commandType) : undefined,
        ),
      )
      .orderBy(desc(paymentOrders.createdAt))
      .limit(query.limit)
      .offset(query.offset)
      .then((rows) => rows.map((r) => ({ ...r.order, serviceCode: r.serviceCode, serviceName: r.serviceName, commandType: r.commandType, netForStock: r.netForStock })));
  }

  /**
   * The order's Formance transactions (reserve, settle, revert, release) with their postings. Posted
   * steps are read from Formance; each posting carries the stocks and amount type we planned for it.
   */
  async ledgerTransactions(id: string) {
    const order = await this.find(id);
    if (!order) throw new NotFoundException('payment order not found');
    const rows = (await this.db.select().from(paymentOrderLedgerTx).where(eq(paymentOrderLedgerTx.paymentOrderId, id))).sort(
      (a, b) => ledgerStep.enumValues.indexOf(a.step) - ledgerStep.enumValues.indexOf(b.step),
    );
    return Promise.all(
      rows.map(async (row) => {
        const planned = row.postings.map(({ overdraft: _, ...p }) => p);
        if (row.ledgerTxId === null) return { step: row.step, status: row.status, ledgerTxId: null, timestamp: null, failureReason: row.failureReason, postings: planned };
        const tx = await this.ledger.getTransaction(Number(row.ledgerTxId));
        // REVERT's planned postings are a mirror for display; Formance's revert order is authoritative.
        const byPair = new Map(planned.map((p) => [`${p.source}>${p.destination}>${p.amount}`, p]));
        return {
          step: row.step,
          status: row.status,
          ledgerTxId: String(row.ledgerTxId),
          timestamp: tx.timestamp,
          failureReason: row.failureReason,
          postings: tx.postings.map((p) => {
            const amount = toDecimal(BigInt(p.amount));
            const match = byPair.get(`${p.source}>${p.destination}>${amount}`);
            return { source: p.source, destination: p.destination, amount, fromStockId: match?.fromStockId ?? null, toStockId: match?.toStockId ?? null, amountType: match?.amountType ?? null, movementSequence: match?.movementSequence ?? null };
          }),
        };
      }),
    );
  }

  // ------------------------------------------------------------------ helpers

  private async prepared(order: PaymentOrder, payer?: StockView): Promise<PreparedOrder> {
    const [cmd] = await this.db.select().from(serviceCommand).where(eq(serviceCommand.id, order.serviceCommandId));
    const payerStock = payer ?? (await this.profiles.stock(order.payerAccountId));
    return {
      orderId: order.id,
      status: order.status,
      // Customers and agents confirm their own payments; the bank's INTERNAL stocks (e.g. cash-in) don't.
      requiresAuthorization: cmd.commandType === 'PAYMENT' && payerStock.profile.profileType !== 'INTERNAL',
      authorizationTimeoutSeconds: AUTH_TIMEOUT_SECONDS,
      spis: await this.catalog.spiCalls(cmd.id),
    };
  }

  private async paymentParties(input: OrderInput, currency: string) {
    if (!input.payerStockId || !input.payeeStockId) throw new BadRequestException('payerStockId and payeeStockId are required');
    if (input.payerStockId === input.payeeStockId) throw new BadRequestException('payer and payee must be different stocks');
    const parties = await this.stocks(input.payerStockId, input.payeeStockId);
    for (const [role, s] of Object.entries(parties)) {
      if (s.currency !== currency) throw new UnprocessableEntityException(`${role} stock is ${s.currency}, the service is ${currency}`);
    }
    if (parties.payer.profile.id !== input.customerId) throw new BadRequestException('customer does not own the payer stock');
    if (!canPay(parties.payer)) {
      throw new UnprocessableEntityException(
        `payer cannot pay: stock ${parties.payer.status}, account ${parties.payer.account.status}, profile ${parties.payer.profile.status}`,
      );
    }
    if (!canReceive(parties.payee)) throw new UnprocessableEntityException('payee stock, account or profile is closed');
    return parties;
  }

  private async stocks(payerId: string, payeeId: string) {
    const found = await this.profiles.stocks([payerId, payeeId]);
    const payer = found.find((s) => s.id === payerId);
    const payee = found.find((s) => s.id === payeeId);
    if (!payer) throw new NotFoundException(`payer stock ${payerId} not found`);
    if (!payee) throw new NotFoundException(`payee stock ${payeeId} not found`);
    return { payer, payee };
  }

  private async originalFor(input: OrderInput, serviceId: string) {
    if (!input.originalOrderId) throw new BadRequestException(`${input.commandType} needs the original order`);
    const original = await this.find(input.originalOrderId);
    if (!original) throw new NotFoundException('original order not found');
    if (original.serviceId !== serviceId) throw new UnprocessableEntityException('original order belongs to another service');
    return original;
  }

  /**
   * REFUND / CANCEL rules, checked with the original order locked so two reversals can't both pass:
   * the original must be a COMPLETED payment; CANCEL reverses everything at once and only if nothing
   * was refunded; REFUND defaults to the rest and can never exceed it.
   */
  private async reversalAmount(tx: Tx, input: OrderInput, original: PaymentOrder) {
    const [locked] = await tx.select().from(paymentOrders).where(eq(paymentOrders.id, original.id)).for('update');
    const [origCmd] = await tx.select().from(serviceCommand).where(eq(serviceCommand.id, locked.serviceCommandId));
    if (origCmd.commandType !== 'PAYMENT') throw new UnprocessableEntityException('only a PAYMENT order can be refunded or cancelled');
    if (locked.status !== 'COMPLETED') throw new UnprocessableEntityException(`original order is ${locked.status}`);
    const [prior] = await tx
      .select({ total: sql<string>`coalesce(sum(${paymentOrders.amount}), 0)::text`, count: sql<number>`count(*)::int` })
      .from(paymentOrders)
      .where(and(eq(paymentOrders.originalOrderId, locked.id), notInArray(paymentOrders.status, ['FAILED', 'CANCELLED'])));
    const total = toMinor(locked.amount);
    const done = toMinor(prior.total);
    if (input.commandType === 'CANCEL') {
      if (prior.count > 0) throw new UnprocessableEntityException('order was already refunded or cancelled');
      return total;
    }
    const amount = input.amount ? parseAmount(input.amount) : total - done;
    if (amount <= 0n) throw new UnprocessableEntityException('order is already fully refunded');
    if (done + amount > total) throw new UnprocessableEntityException(`refund exceeds the ${toDecimal(total - done)} still refundable`);
    return amount;
  }

  private findByKey(customerId: string, key: string) {
    return this.db
      .select()
      .from(paymentOrders)
      .where(and(eq(paymentOrders.customerId, customerId), eq(paymentOrders.idempotencyKey, key)))
      .then((r) => r[0]);
  }

  private unprocessable<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      throw new UnprocessableEntityException((err as Error).message);
    }
  }
}

