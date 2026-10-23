import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, desc, eq, ne, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { CatalogService } from '../catalog/catalog.service.js';
import { ASSETS, parseAmount } from '../common/money.js';
import { isUniqueViolation } from '../common/pg-errors.js';
import { CustomerClient, type CustomerAccount } from '../customers/customer.client.js';
import { DRIZZLE, type Database } from '../db/database.module.js';
import {
  ledgerOutbox,
  services,
  transferAmounts,
  transferEvents,
  transfers,
  type AmountType,
  type Command,
  type Currency,
  type LedgerRequest,
  type PlannedPosting,
  type ServiceCommand,
  type ServicePricingTier,
  type Transfer,
} from '../db/schema.js';
import { LedgerClient } from '../ledger/ledger.client.js';
import { accountAddress, planPostings, toNumscript, type MovementEntry } from '../movement/movement.js';
import { computeAmounts, type AmountValues } from '../pricing/pricing.js';
import type { ExecuteCommandDto, ListTransfersQuery, PaymentDto, TopupDto } from './dto.js';
import { LedgerPoster } from './ledger-poster.service.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Prepared = {
  transfer: typeof transfers.$inferInsert;
  amounts: (typeof transferAmounts.$inferInsert)[];
  request: LedgerRequest;
  postings: PlannedPosting[];
};
type Parties = { source?: CustomerAccount; destination?: CustomerAccount };

const TOPUP_MOVEMENT: MovementEntry[] = [
  { entryNo: 1, side: 'debit', account: '@world', amountType: 'amount', allowOverdraft: false },
  { entryNo: 2, side: 'credit', account: '{destination}', amountType: 'amount', allowOverdraft: false },
];

const usesAccount = (entries: MovementEntry[], account: string) => entries.some((e) => e.account === account);

@Injectable()
export class TransfersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly catalog: CatalogService,
    private readonly customers: CustomerClient,
    private readonly poster: LedgerPoster,
    private readonly ledger: LedgerClient,
  ) {}

  /**
   * Runs a service command. The caller only sends amount, currency, source and destination;
   * every other amount type comes from the command's pricing tiers, and the command's balance
   * movement (debit/credit entries) decides which account pays or receives each one.
   */
  async executeCommand(code: string, command: Command, dto: ExecuteCommandDto, idempotencyKey: string) {
    const replay = await this.findByIdempotencyKey(idempotencyKey);
    if (replay) return replay;

    const { service, command: cmd, entries } = await this.catalog.resolveForExecution(code, command);
    const parties =
      command === 'payment'
        ? await this.paymentParties(code, entries, dto)
        : await this.reversalParties(dto);

    const id = randomUUID();
    const now = new Date();

    return this.createAndPost(idempotencyKey, async (tx) => {
      const amount =
        command === 'payment'
          ? parseAmount(dto.amount!)
          : await this.reversalAmount(tx, command, cmd, service.id, dto, now);

      const priced = await this.catalog.assertInRange(tx, cmd, dto.currency, amount, now);
      const tiers = await this.catalog.findPricingTiers(tx, cmd, dto.currency, amount, now);
      const values = this.price(amount, tiers, cmd);
      const plan = this.plan(entries, values.values, dto.currency, parties, service.serviceCode, () =>
        priced ? undefined : `${code} ${command} is not configured for ${dto.currency}`,
      );

      return {
        transfer: {
          id,
          idempotencyKey,
          type: command,
          serviceId: service.id,
          serviceCommandId: cmd.id,
          originalTransferId: dto.originalTransferId ?? null,
          ...this.partyColumns(parties, plan.effects),
          currency: dto.currency,
          asset: ASSETS[dto.currency],
          amount,
          externalRef: dto.externalRef ?? null,
          metadata: dto.metadata ?? {},
        },
        amounts: this.amountRows(id, values.values, values.tierIds),
        postings: plan.postings,
        request: this.ledgerRequest(id, plan.plain, {
          type: command,
          service_code: service.serviceCode,
          ...(parties.source && { source_customer_id: parties.source.customerId }),
          ...(parties.destination && { destination_customer_id: parties.destination.customerId }),
          ...(dto.originalTransferId && { original_transfer_id: dto.originalTransferId }),
          ...(dto.externalRef && { external_ref: dto.externalRef }),
        }),
      };
    });
  }

  /** POST /payments: the `payment` command of the given service. */
  pay(dto: PaymentDto, idempotencyKey: string) {
    const { serviceCode, ...rest } = dto;
    return this.executeCommand(serviceCode, 'payment', rest, idempotencyKey);
  }

  /** Refund or cancel a payment by its id; the service, currency and parties come from the payment. */
  async reversePayment(
    paymentId: string,
    command: Exclude<Command, 'payment'>,
    amount: string | undefined,
    idempotencyKey: string,
  ) {
    const [payment] = await this.db
      .select({ type: transfers.type, currency: transfers.currency, serviceCode: services.serviceCode })
      .from(transfers)
      .innerJoin(services, eq(services.id, transfers.serviceId))
      .where(eq(transfers.id, paymentId));
    if (!payment || payment.type !== 'payment') throw new NotFoundException('payment not found');
    if (command === 'cancel' && amount) throw new BadRequestException('cancel always reverses the full amount');
    return this.executeCommand(
      payment.serviceCode,
      command,
      { currency: payment.currency, amount, originalTransferId: paymentId },
      idempotencyKey,
    );
  }

  /** System flow: money arriving from the partner bank (@world) into a customer account. */
  async topup(dto: TopupDto, idempotencyKey: string) {
    const replay = await this.findByIdempotencyKey(idempotencyKey);
    if (replay) return replay;

    const amount = parseAmount(dto.amount);
    const account = await this.customers.getAccount(dto.customerId, dto.currency);
    if (account.status === 'closed' || account.customerStatus === 'closed') {
      throw new UnprocessableEntityException('account is closed');
    }

    const id = randomUUID();
    const { values } = computeAmounts(amount, [], { netAmountAdd: [], netAmountSubtract: [] });
    const plan = this.plan(TOPUP_MOVEMENT, values, dto.currency, { destination: account }, 'topup');

    return this.createAndPost(idempotencyKey, async () => ({
      transfer: {
        id,
        idempotencyKey,
        type: 'topup' as const,
        ...this.partyColumns({ destination: account }, plan.effects),
        currency: dto.currency,
        asset: ASSETS[dto.currency],
        amount,
        externalRef: dto.externalRef,
      },
      amounts: this.amountRows(id, values, {}),
      postings: plan.postings,
      request: this.ledgerRequest(id, plan.plain, {
        type: 'topup',
        destination_customer_id: dto.customerId,
        external_ref: dto.externalRef,
      }),
    }));
  }

  async get(id: string) {
    const [transfer] = await this.db.select().from(transfers).where(eq(transfers.id, id));
    if (!transfer) throw new NotFoundException('transfer not found');
    const [amounts, events] = await Promise.all([
      this.db
        .select({
          amountType: transferAmounts.amountType,
          amount: transferAmounts.amount,
          pricingTierId: transferAmounts.pricingTierId,
        })
        .from(transferAmounts)
        .where(eq(transferAmounts.transferId, id)),
      this.db
        .select()
        .from(transferEvents)
        .where(eq(transferEvents.transferId, id))
        .orderBy(asc(transferEvents.id)),
    ]);
    return { ...transfer, amounts, events };
  }

  list(query: ListTransfersQuery) {
    return this.db
      .select()
      .from(transfers)
      .where(
        and(
          or(eq(transfers.sourceCustomerId, query.customerId), eq(transfers.destinationCustomerId, query.customerId)),
          query.currency && eq(transfers.currency, query.currency),
          query.type && eq(transfers.type, query.type),
          query.status && eq(transfers.status, query.status),
        ),
      )
      .orderBy(desc(transfers.createdAt))
      .limit(query.limit)
      .offset(query.offset);
  }

  /** The Formance transaction behind a transfer, each posting tagged with its debit/credit amount types. */
  async ledgerTransaction(id: string) {
    const [row] = await this.db
      .select({ ledgerTxId: transfers.ledgerTxId, planned: ledgerOutbox.postings })
      .from(transfers)
      .leftJoin(ledgerOutbox, eq(ledgerOutbox.transferId, transfers.id))
      .where(eq(transfers.id, id));
    if (!row) throw new NotFoundException('transfer not found');
    if (row.ledgerTxId === null) return null;

    const tx = await this.ledger.getTransaction(Number(row.ledgerTxId));
    // Formance does not keep amount types; we planned the postings (send N → posting N).
    const planned = row.planned ?? [];
    const matches = (i: number) =>
      planned[i]?.source === tx.postings[i].source && planned[i]?.destination === tx.postings[i].destination;
    return {
      ...tx,
      postings: tx.postings.map((p, i) => ({
        ...p,
        debitType: matches(i) ? planned[i].debitType : null,
        creditType: matches(i) ? planned[i].creditType : null,
      })),
    };
  }

  /**
   * Inserts the transfer, its amounts, its first event and its outbox row in one database
   * transaction, then tries to post it to the ledger immediately. If that attempt cannot reach
   * the ledger, the transfer stays pending and the outbox worker retries it.
   */
  private async createAndPost(idempotencyKey: string, prepare: (tx: Tx) => Promise<Prepared>) {
    let transferId: string;
    try {
      transferId = await this.db.transaction(async (tx) => {
        const { transfer, amounts, request, postings } = await prepare(tx);
        const [row] = await tx.insert(transfers).values(transfer).returning({ id: transfers.id });
        await tx.insert(transferAmounts).values(amounts);
        await tx.insert(transferEvents).values({ transferId: row.id, toStatus: 'pending', reason: 'created' });
        await tx.insert(ledgerOutbox).values({ transferId: row.id, request, postings });
        return row.id;
      });
    } catch (err) {
      if (isUniqueViolation(err, 'transfers_idempotency_key_unique')) {
        const replay = await this.findByIdempotencyKey(idempotencyKey);
        if (replay) return replay;
      }
      if (isUniqueViolation(err, 'transfers_type_external_ref_unique')) {
        throw new ConflictException('externalRef already used for this transfer type');
      }
      throw err;
    }

    await this.poster.postNow(transferId);
    return this.get(transferId);
  }

  private async paymentParties(code: string, entries: MovementEntry[], dto: ExecuteCommandDto): Promise<Parties> {
    if (dto.originalTransferId) throw new BadRequestException('payment does not take originalTransferId');
    if (!dto.amount || !dto.source) throw new BadRequestException('payment needs amount and source');
    const needsDestination = usesAccount(entries, '{destination}');
    if (needsDestination && !dto.destination) {
      throw new BadRequestException(`service ${code} needs a destination customer`);
    }
    if (!needsDestination && dto.destination) {
      throw new BadRequestException(`service ${code} does not take a destination`);
    }
    if (dto.destination === dto.source) throw new BadRequestException('source and destination must differ');

    const [source, destination] = await Promise.all([
      this.customers.getAccount(dto.source, dto.currency),
      dto.destination ? this.customers.getAccount(dto.destination, dto.currency) : undefined,
    ]);
    if (source.customerStatus !== 'active') {
      throw new UnprocessableEntityException(`source customer is ${source.customerStatus}`);
    }
    if (source.status !== 'active') throw new UnprocessableEntityException(`source account is ${source.status}`);
    if (destination && (destination.status === 'closed' || destination.customerStatus === 'closed')) {
      throw new UnprocessableEntityException('destination account is closed');
    }
    return { source, destination };
  }

  /** Refund and cancel move money between the same parties as the original payment. */
  private async reversalParties(dto: ExecuteCommandDto): Promise<Parties> {
    if (!dto.originalTransferId) throw new BadRequestException('refund and cancel need originalTransferId');
    if (dto.source || dto.destination) {
      throw new BadRequestException('refund and cancel use the source and destination of the original payment');
    }
    const [original] = await this.db.select().from(transfers).where(eq(transfers.id, dto.originalTransferId));
    if (!original) throw new NotFoundException('original transfer not found');
    if (original.currency !== dto.currency) {
      throw new UnprocessableEntityException('currency does not match the original payment');
    }
    const lookup = (customerId: string | null) =>
      customerId ? this.customers.getAccount(customerId, original.currency) : undefined;
    const [source, destination] = await Promise.all([
      lookup(original.sourceCustomerId),
      lookup(original.destinationCustomerId),
    ]);
    for (const party of [source, destination]) {
      if (party?.status === 'closed') throw new UnprocessableEntityException('an account of the original payment is closed');
    }
    return { source, destination };
  }

  /**
   * Validates a refund or cancel against the original payment (locked for the rest of the
   * database transaction, so two reversals of the same payment cannot both pass the checks)
   * and returns the amount to reverse.
   */
  private async reversalAmount(
    tx: Tx,
    command: Exclude<Command, 'payment'>,
    cmd: ServiceCommand,
    serviceId: string,
    dto: ExecuteCommandDto,
    now: Date,
  ) {
    const [original] = await tx
      .select()
      .from(transfers)
      .where(eq(transfers.id, dto.originalTransferId!))
      .for('update');
    if (!original) throw new NotFoundException('original transfer not found');
    if (original.type !== 'payment' || original.serviceId !== serviceId) {
      throw new UnprocessableEntityException('original transfer is not a payment of this service');
    }
    if (original.status !== 'posted') {
      throw new UnprocessableEntityException(`original payment is ${original.status}`);
    }
    if (cmd.maxAgeMinutes !== null && now.getTime() - original.createdAt.getTime() > cmd.maxAgeMinutes * 60_000) {
      throw new UnprocessableEntityException(`${command} window of ${cmd.maxAgeMinutes} minutes has passed`);
    }

    const [prior] = await tx
      .select({
        reversed: sql<string>`coalesce(sum(${transfers.amount}), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(transfers)
      .where(and(eq(transfers.originalTransferId, original.id), ne(transfers.status, 'failed')));
    const alreadyReversed = BigInt(prior.reversed);

    if (command === 'cancel') {
      if (prior.count > 0) throw new UnprocessableEntityException('payment was already refunded or cancelled');
      return original.amount;
    }
    const amount = dto.amount ? parseAmount(dto.amount) : original.amount - alreadyReversed;
    if (amount <= 0n) throw new UnprocessableEntityException('payment is already fully refunded');
    if (!cmd.allowPartial && (prior.count > 0 || amount !== original.amount)) {
      throw new UnprocessableEntityException('partial refunds are not allowed for this service');
    }
    if (alreadyReversed + amount > original.amount) {
      throw new UnprocessableEntityException('refund exceeds the original payment');
    }
    return amount;
  }

  private price(amount: bigint, tiers: ServicePricingTier[], cmd: ServiceCommand) {
    try {
      const { values, ruleIds } = computeAmounts(amount, tiers, cmd);
      return { values, tierIds: ruleIds };
    } catch (err) {
      throw new UnprocessableEntityException((err as Error).message);
    }
  }

  /**
   * Turns the command's debit/credit entries into ledger postings and Numscript. The movement was
   * checked when it was saved; checking again here guarantees nothing unbalanced is ever posted.
   */
  private plan(
    entries: MovementEntry[],
    values: AmountValues,
    currency: Currency,
    parties: Parties,
    serviceCode: string,
    explain: () => string | undefined = () => undefined,
  ) {
    const resolve = (account: string) => {
      if (account === '@world') return 'world';
      if (account === '{source}' || account === '{destination}') {
        const party = account === '{source}' ? parties.source : parties.destination;
        if (!party) throw new Error(`no ${account} customer for this transaction`);
        return party.ledgerAddress;
      }
      return accountAddress(account, serviceCode, currency);
    };
    try {
      const { postings, effects } = planPostings(entries, values, resolve);
      return {
        postings: postings.map(({ overdraft: _, ...p }) => p),
        effects,
        plain: toNumscript(postings, ASSETS[currency]),
      };
    } catch (err) {
      throw new UnprocessableEntityException(explain() ?? (err as Error).message);
    }
  }

  private partyColumns(
    parties: Parties,
    effects: Map<string, bigint>,
  ): Pick<
    Transfer,
    'sourceCustomerId' | 'sourceAccountId' | 'sourceNet' | 'destinationCustomerId' | 'destinationAccountId' | 'destinationNet'
  > {
    return {
      sourceCustomerId: parties.source?.customerId ?? null,
      sourceAccountId: parties.source?.id ?? null,
      sourceNet: parties.source ? (effects.get('{source}') ?? 0n) : null,
      destinationCustomerId: parties.destination?.customerId ?? null,
      destinationAccountId: parties.destination?.id ?? null,
      destinationNet: parties.destination ? (effects.get('{destination}') ?? 0n) : null,
    };
  }

  /** Stores amount and net_amount always, plus every priced type that came out non-zero. */
  private amountRows(transferId: string, values: AmountValues, tierIds: Partial<Record<AmountType, string>>) {
    return (Object.entries(values) as [AmountType, bigint][])
      .filter(([type, value]) => type === 'amount' || type === 'net_amount' || value !== 0n)
      .map(([amountType, amount]) => ({
        transferId,
        amountType,
        amount,
        pricingTierId: tierIds[amountType] ?? null,
      }));
  }

  private ledgerRequest(transferId: string, plain: string, metadata: Record<string, string>): LedgerRequest {
    return {
      script: { plain, vars: {} },
      reference: transferId,
      metadata: { transfer_id: transferId, ...metadata },
    };
  }

  private async findByIdempotencyKey(key: string) {
    const [existing] = await this.db
      .select({ id: transfers.id })
      .from(transfers)
      .where(eq(transfers.idempotencyKey, key));
    return existing ? this.get(existing.id) : null;
  }
}
