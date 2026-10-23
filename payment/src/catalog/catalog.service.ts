import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, eq, gt, gte, isNull, lte, or } from 'drizzle-orm';
import { MAX_AMOUNT } from '../common/money.js';
import { isExclusionViolation, isUniqueViolation } from '../common/pg-errors.js';
import { DRIZZLE, type Database } from '../db/database.module.js';
import {
  ACCOUNT_PATH_PATTERN,
  CURRENCIES,
  PARTY_ACCOUNTS,
  serviceCommands,
  serviceMovementEntries,
  servicePricingTiers,
  services,
  type Command,
  type Currency,
  type ServiceCommand,
} from '../db/schema.js';
import { amountRange, checkBalance, type MovementEntry } from '../movement/movement.js';
import type {
  CreatePricingTierDto,
  CreateServiceDto,
  MovementDto,
  RetirePricingTierDto,
  UpdateServiceDto,
  UpsertCommandDto,
} from './dto.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Services, their commands (payment / refund / cancel), pricing tiers and balance movements. */
@Injectable()
export class CatalogService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async createService(dto: CreateServiceDto) {
    try {
      const [service] = await this.db.insert(services).values(dto).returning();
      return service;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('service code already exists');
      throw err;
    }
  }

  listServices() {
    return this.db.select().from(services).orderBy(asc(services.serviceCode));
  }

  async getService(code: string) {
    const service = await this.findService(code);
    const commands = await this.db
      .select()
      .from(serviceCommands)
      .where(eq(serviceCommands.serviceId, service.id))
      .orderBy(asc(serviceCommands.command));

    return {
      ...service,
      commands: await Promise.all(
        commands.map(async (cmd) => ({
          ...cmd,
          movement: await this.entriesOf(cmd.id),
          pricingTiers: await this.db
            .select()
            .from(servicePricingTiers)
            .where(eq(servicePricingTiers.serviceCommandId, cmd.id))
            .orderBy(
              asc(servicePricingTiers.amountType),
              asc(servicePricingTiers.currency),
              asc(servicePricingTiers.minAmount),
            ),
        })),
      ),
    };
  }

  async updateService(code: string, dto: UpdateServiceDto) {
    const [service] = await this.db
      .update(services)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(services.serviceCode, code))
      .returning();
    if (!service) throw new NotFoundException('service not found');
    return service;
  }

  /** Creates or updates a command's settings and net-amount formula. */
  async upsertCommand(code: string, command: Command, dto: UpsertCommandDto) {
    const add = new Set(dto.netAmountAdd ?? []);
    if ((dto.netAmountSubtract ?? []).some((t) => add.has(t))) {
      throw new BadRequestException('an amount type cannot be both added to and subtracted from net_amount');
    }
    if (command === 'payment' && (dto.allowPartial || dto.maxAgeMinutes)) {
      throw new BadRequestException('allowPartial and maxAgeMinutes apply to refund/cancel only');
    }
    const service = await this.findService(code);
    const values = {
      status: dto.status ?? 'active',
      allowPartial: dto.allowPartial ?? false,
      maxAgeMinutes: dto.maxAgeMinutes ?? null,
      netAmountAdd: dto.netAmountAdd ?? [],
      netAmountSubtract: dto.netAmountSubtract ?? [],
    };
    const [cmd] = await this.db
      .insert(serviceCommands)
      .values({ serviceId: service.id, command, ...values })
      .onConflictDoUpdate({
        target: [serviceCommands.serviceId, serviceCommands.command],
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
    return cmd;
  }

  /**
   * Checks a balance movement against the command's current pricing tiers without saving it:
   * Σ debits must equal Σ credits for every sampled amount in every currency.
   */
  async checkMovement(code: string, command: Command, dto: MovementDto) {
    this.validateEntries(dto);
    const cmd = await this.findCommand(code, command);
    return this.balanceReport(cmd, this.toEntries(dto));
  }

  /** Replaces a command's balance movement; refused unless it balances. */
  async setMovement(code: string, command: Command, dto: MovementDto) {
    this.validateEntries(dto);
    const cmd = await this.findCommand(code, command);
    const entries = this.toEntries(dto);
    const report = await this.balanceReport(cmd, entries);
    if (!report.balanced) {
      throw new BadRequestException({
        message: 'balance movement is not balanced: debits must equal credits',
        problems: report.problems,
      });
    }
    return this.db.transaction(async (tx) => {
      await tx.delete(serviceMovementEntries).where(eq(serviceMovementEntries.serviceCommandId, cmd.id));
      const saved = await tx
        .insert(serviceMovementEntries)
        .values(entries.map((e) => ({ ...e, serviceCommandId: cmd.id })))
        .returning();
      return { ...report, entries: saved };
    });
  }

  /**
   * Adds a pricing tier. The tier is saved even if the movement no longer balances (tiers are often
   * added one by one); the response carries the movement check so the admin sees what to fix.
   */
  async addPricingTier(code: string, command: Command, dto: CreatePricingTierDto) {
    const cmd = await this.findCommand(code, command);
    const minAmount = BigInt(dto.minAmount);
    const maxAmount = dto.maxAmount === undefined ? null : BigInt(dto.maxAmount);
    if (maxAmount !== null && maxAmount < minAmount) {
      throw new BadRequestException('maxAmount must be >= minAmount');
    }
    if (dto.baseAmountType === dto.amountType) {
      throw new BadRequestException('baseAmountType must differ from amountType');
    }
    let tier;
    try {
      [tier] = await this.db
        .insert(servicePricingTiers)
        .values({
          serviceCommandId: cmd.id,
          amountType: dto.amountType,
          currency: dto.currency,
          minAmount,
          maxAmount,
          calcType: dto.calcType,
          baseAmountType: dto.baseAmountType ?? 'amount',
          includeBase: dto.includeBase ?? false,
          fixedAmount: BigInt(dto.fixedAmount ?? '0'),
          percentBps: dto.percentBps ?? 0,
          minValue: dto.minValue === undefined ? null : BigInt(dto.minValue),
          maxValue: dto.maxValue === undefined ? null : BigInt(dto.maxValue),
          ...(dto.effectiveFrom && { effectiveFrom: new Date(dto.effectiveFrom) }),
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        })
        .returning();
    } catch (err) {
      if (isExclusionViolation(err)) {
        throw new ConflictException(
          'pricing tier overlaps an existing band for this amount type, currency and period',
        );
      }
      throw err;
    }
    const entries = await this.entriesOf(cmd.id);
    return { ...tier, movementCheck: entries.length ? await this.balanceReport(cmd, entries) : null };
  }

  /** Tiers are never edited in place (transfers reference them); retire one and add a new one instead. */
  async retirePricingTier(id: string, dto: { effectiveTo: string }) {
    const [tier] = await this.db
      .update(servicePricingTiers)
      .set({ effectiveTo: new Date(dto.effectiveTo) })
      .where(eq(servicePricingTiers.id, id))
      .returning();
    if (!tier) throw new NotFoundException('pricing tier not found');
    return tier;
  }

  /** Loads everything needed to execute a command, enforcing that service and command are active. */
  async resolveForExecution(code: string, command: Command) {
    const service = await this.findService(code);
    if (service.status !== 'active') {
      throw new UnprocessableEntityException(`service ${code} is ${service.status}`);
    }
    const cmd = await this.findCommand(code, command, service.id);
    if (cmd.status !== 'active') {
      throw new UnprocessableEntityException(`command ${command} is disabled for ${code}`);
    }
    const entries = await this.entriesOf(cmd.id);
    if (!entries.length) throw new UnprocessableEntityException(`command ${command} has no balance movement`);
    return { service, command: cmd, entries };
  }

  /** Every specific account path used by any command of a service (for its balances). */
  async accountPaths(code: string): Promise<string[]> {
    const service = await this.findService(code);
    const rows = await this.db
      .selectDistinct({ account: serviceMovementEntries.account })
      .from(serviceMovementEntries)
      .innerJoin(serviceCommands, eq(serviceCommands.id, serviceMovementEntries.serviceCommandId))
      .where(eq(serviceCommands.serviceId, service.id));
    return rows
      .map((r) => r.account)
      .filter((a) => !(PARTY_ACCOUNTS as readonly string[]).includes(a))
      .sort();
  }

  /** Rejects an amount outside the command's configured bands; returns whether the currency has any tiers. */
  async assertInRange(db: Tx | Database, cmd: ServiceCommand, currency: Currency, amount: bigint, at: Date) {
    const bands = await db
      .select({ minAmount: servicePricingTiers.minAmount, maxAmount: servicePricingTiers.maxAmount })
      .from(servicePricingTiers)
      .where(
        and(
          eq(servicePricingTiers.serviceCommandId, cmd.id),
          eq(servicePricingTiers.currency, currency),
          lte(servicePricingTiers.effectiveFrom, at),
          or(isNull(servicePricingTiers.effectiveTo), gt(servicePricingTiers.effectiveTo, at)),
        ),
      );
    const range = amountRange(bands);
    if (!range) return false;
    if (amount < range.min || (range.max !== null && amount > range.max)) {
      throw new UnprocessableEntityException(
        `amount ${amount} is outside the ${currency} range ${range.min}–${range.max ?? '∞'} configured for ${cmd.command}`,
      );
    }
    return true;
  }

  /** The tiers in effect for this currency and request amount: at most one per amount type. */
  findPricingTiers(db: Tx | Database, cmd: ServiceCommand, currency: Currency, amount: bigint, at: Date) {
    return db
      .select()
      .from(servicePricingTiers)
      .where(
        and(
          eq(servicePricingTiers.serviceCommandId, cmd.id),
          eq(servicePricingTiers.currency, currency),
          lte(servicePricingTiers.minAmount, amount),
          or(isNull(servicePricingTiers.maxAmount), gte(servicePricingTiers.maxAmount, amount)),
          lte(servicePricingTiers.effectiveFrom, at),
          or(isNull(servicePricingTiers.effectiveTo), gt(servicePricingTiers.effectiveTo, at)),
        ),
      );
  }

  /** Σ debits vs Σ credits at sampled amounts, per currency, with the tiers in effect now. */
  private async balanceReport(cmd: ServiceCommand, entries: MovementEntry[]) {
    const now = new Date();
    const tiers = await this.db
      .select()
      .from(servicePricingTiers)
      .where(
        and(
          eq(servicePricingTiers.serviceCommandId, cmd.id),
          lte(servicePricingTiers.effectiveFrom, now),
          or(isNull(servicePricingTiers.effectiveTo), gt(servicePricingTiers.effectiveTo, now)),
        ),
      );
    const problems = [];
    // A currency with no tiers whose movement only balances with priced amounts is simply not
    // offered for this command: reported, not blocking. Payments in it are refused at run time.
    const unconfiguredCurrencies: Currency[] = [];
    for (const currency of CURRENCIES) {
      const rules = tiers.filter((t) => t.currency === currency);
      try {
        const found = checkBalance(entries, rules, cmd, MAX_AMOUNT);
        if (found.length && !rules.length) unconfiguredCurrencies.push(currency);
        else problems.push(...found.map((p) => ({ currency, ...p })));
      } catch (err) {
        problems.push({ currency, amount: '-', debit: '-', credit: '-', error: (err as Error).message });
      }
    }
    return { balanced: problems.length === 0, unconfiguredCurrencies, problems: problems.slice(0, 20) };
  }

  private entriesOf(commandId: string): Promise<MovementEntry[]> {
    return this.db
      .select({
        entryNo: serviceMovementEntries.entryNo,
        side: serviceMovementEntries.side,
        account: serviceMovementEntries.account,
        amountType: serviceMovementEntries.amountType,
        allowOverdraft: serviceMovementEntries.allowOverdraft,
      })
      .from(serviceMovementEntries)
      .where(eq(serviceMovementEntries.serviceCommandId, commandId))
      .orderBy(asc(serviceMovementEntries.entryNo));
  }

  private toEntries(dto: MovementDto): MovementEntry[] {
    return dto.entries.map((e) => ({ ...e, allowOverdraft: e.allowOverdraft ?? false }));
  }

  private validateEntries(dto: MovementDto) {
    const numbers = new Set(dto.entries.map((e) => e.entryNo));
    if (numbers.size !== dto.entries.length) throw new BadRequestException('entryNo must be unique');
    if (!dto.entries.some((e) => e.side === 'debit') || !dto.entries.some((e) => e.side === 'credit')) {
      throw new BadRequestException('a balance movement needs at least one debit and one credit');
    }
    for (const e of dto.entries) {
      const party = (PARTY_ACCOUNTS as readonly string[]).includes(e.account);
      if (!party && !ACCOUNT_PATH_PATTERN.test(e.account)) {
        throw new BadRequestException(
          `entry ${e.entryNo}: account must be ${PARTY_ACCOUNTS.join(', ')} or a path like platform:fees:{service}`,
        );
      }
      if (party && e.allowOverdraft) {
        throw new BadRequestException(`entry ${e.entryNo}: allowOverdraft is only for specific accounts`);
      }
    }
  }

  private async findService(code: string) {
    const [service] = await this.db.select().from(services).where(eq(services.serviceCode, code));
    if (!service) throw new NotFoundException(`service ${code} not found`);
    return service;
  }

  private async findCommand(code: string, command: Command, serviceId?: string) {
    const id = serviceId ?? (await this.findService(code)).id;
    const [cmd] = await this.db
      .select()
      .from(serviceCommands)
      .where(and(eq(serviceCommands.serviceId, id), eq(serviceCommands.command, command)));
    if (!cmd) throw new NotFoundException(`command ${command} not configured for ${code}`);
    return cmd;
  }
}
