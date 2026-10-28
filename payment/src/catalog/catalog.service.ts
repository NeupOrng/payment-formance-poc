import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { toDecimal, toMinor } from '../common/money.js';
import { pgError } from '../common/pg-errors.js';
import { DRIZZLE, type Database } from '../db/database.module.js';
import {
  amountType,
  balanceMovementConfig,
  service,
  serviceCommand,
  serviceCommandSpi,
  serviceGroup,
  spi,
  spiExternalConfig,
  spiInternalConfig,
  tierAmountRule,
  tierConfig,
  type CommandType,
  type ServiceCommand,
} from '../db/schema.js';
import { resolveMovements } from '../movement/movement.js';
import { computeAmounts, validateRules, type AmountRule } from '../pricing/pricing.js';
import { canReceive, ProfileClient } from '../profile/profile.client.js';
import type {
  AddCommandSpiDto,
  CreateAmountTypeDto,
  CreateServiceDto,
  CreateServiceGroupDto,
  CreateSpiDto,
  CreateTierDto,
  StatusDto,
  UpdateServiceDto,
  UpdateServiceGroupDto,
  UpsertCommandDto,
} from './dto.js';

type Db = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export type SpiCall = {
  stage: 'PRE_PAYMENT' | 'POST_PAYMENT' | 'NOTIFICATION';
  sequence: number;
  spiCode: string;
  spiType: 'INTERNAL' | 'EXTERNAL';
  operation: string;
  timeoutMs: number;
  maxRetries: number;
};

const conflict = (err: unknown, message: string) => {
  const code = pgError(err)?.code;
  if (code === '23505') return new ConflictException(message);
  if (code === '23P01') return new ConflictException('an ACTIVE tier of this command already covers part of that amount range');
  if (code === '23503') return new BadRequestException('referenced record does not exist');
  if (code === '23514') return new BadRequestException(`violates a rule of the schema: ${pgError(err)?.constraint}`);
  return err;
};

/** Configuration: service groups → services → commands → tiers (amount rules + balance movements) and SPIs. */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly profiles: ProfileClient,
  ) {}

  // ------------------------------------------------------------------ amount types and groups

  listAmountTypes() {
    return this.db.select().from(amountType).orderBy(asc(amountType.code));
  }

  async createAmountType(dto: CreateAmountTypeDto) {
    try {
      const [row] = await this.db.insert(amountType).values(dto).returning();
      return row;
    } catch (err) {
      throw conflict(err, `amount type ${dto.code} already exists`);
    }
  }

  listGroups() {
    return this.db.select().from(serviceGroup).orderBy(asc(serviceGroup.name));
  }

  async createGroup(dto: CreateServiceGroupDto) {
    const [row] = await this.db.insert(serviceGroup).values(dto).returning();
    return row;
  }

  async updateGroup(id: string, dto: UpdateServiceGroupDto) {
    const [row] = await this.db.update(serviceGroup).set({ ...dto, updatedAt: new Date() }).where(eq(serviceGroup.id, id)).returning();
    if (!row) throw new NotFoundException('service group not found');
    return row;
  }

  // ------------------------------------------------------------------ services and commands

  async createService(dto: CreateServiceDto) {
    try {
      const [row] = await this.db.insert(service).values(dto).returning();
      return row;
    } catch (err) {
      throw conflict(err, `service ${dto.code} already exists`);
    }
  }

  listServices() {
    return this.db
      .select({ service, group: { id: serviceGroup.id, name: serviceGroup.name, status: serviceGroup.status } })
      .from(service)
      .innerJoin(serviceGroup, eq(serviceGroup.id, service.serviceGroupId))
      .orderBy(asc(service.code))
      .then((rows) => rows.map((r) => ({ ...r.service, group: r.group })));
  }

  /** The whole configuration of a service: commands with their SPI calls and tiers (rules + movements). */
  async getService(code: string) {
    const svc = await this.findService(code);
    const [group] = await this.db.select().from(serviceGroup).where(eq(serviceGroup.id, svc.serviceGroupId));
    const commands = await this.db.select().from(serviceCommand).where(eq(serviceCommand.serviceId, svc.id)).orderBy(asc(serviceCommand.commandType));
    return {
      ...svc,
      group,
      commands: await Promise.all(
        commands.map(async (cmd) => ({
          ...cmd,
          spis: await this.commandSpiRows(cmd.id),
          tiers: await Promise.all(
            (await this.db.select().from(tierConfig).where(eq(tierConfig.serviceCommandId, cmd.id)).orderBy(asc(tierConfig.minAmount)))
              .map(async (tier) => ({ ...tier, ...(await this.tierDetails(tier.id)) })),
          ),
        })),
      ),
    };
  }

  async updateService(code: string, dto: UpdateServiceDto) {
    const [row] = await this.db.update(service).set({ ...dto, updatedAt: new Date() }).where(eq(service.code, code)).returning();
    if (!row) throw new NotFoundException(`service ${code} not found`);
    return row;
  }

  async upsertCommand(code: string, type: CommandType, dto: UpsertCommandDto) {
    const svc = await this.findService(code);
    const status = dto.status ?? 'ACTIVE';
    const [row] = await this.db
      .insert(serviceCommand)
      .values({ serviceId: svc.id, commandType: type, status })
      .onConflictDoUpdate({ target: [serviceCommand.serviceId, serviceCommand.commandType], set: { status, updatedAt: new Date() } })
      .returning();
    return row;
  }

  // ------------------------------------------------------------------ SPIs

  async createSpi(dto: CreateSpiDto) {
    const config = dto.spiType === 'INTERNAL' ? dto.internal : dto.external;
    if (!config || (dto.spiType === 'INTERNAL' ? dto.external : dto.internal)) {
      throw new BadRequestException(`an ${dto.spiType} SPI needs exactly its "${dto.spiType.toLowerCase()}" config`);
    }
    try {
      const id = await this.db.transaction(async (tx) => {
        const [row] = await tx.insert(spi).values({ code: dto.code, name: dto.name, spiType: dto.spiType }).returning();
        if (dto.internal) await tx.insert(spiInternalConfig).values({ spiId: row.id, ...dto.internal });
        if (dto.external) await tx.insert(spiExternalConfig).values({ spiId: row.id, ...dto.external, credentialRef: dto.external.credentialRef ?? null });
        return row.id;
      });
      return (await this.listSpis()).find((s) => s.id === id);
    } catch (err) {
      throw conflict(err, `SPI ${dto.code} already exists`);
    }
  }

  async listSpis() {
    const rows = await this.db
      .select({ spi, internal: spiInternalConfig, external: spiExternalConfig })
      .from(spi)
      .leftJoin(spiInternalConfig, eq(spiInternalConfig.spiId, spi.id))
      .leftJoin(spiExternalConfig, eq(spiExternalConfig.spiId, spi.id))
      .orderBy(asc(spi.code));
    return rows.map((r) => ({ ...r.spi, internal: r.internal, external: r.external }));
  }

  async updateSpi(code: string, dto: StatusDto) {
    const [row] = await this.db.update(spi).set({ status: dto.status, updatedAt: new Date() }).where(eq(spi.code, code)).returning();
    if (!row) throw new NotFoundException(`SPI ${code} not found`);
    return row;
  }

  async addCommandSpi(code: string, type: CommandType, dto: AddCommandSpiDto) {
    const cmd = await this.findCommand(code, type);
    const [target] = await this.db.select().from(spi).where(eq(spi.code, dto.spiCode));
    if (!target) throw new NotFoundException(`SPI ${dto.spiCode} not found`);
    try {
      const [row] = await this.db
        .insert(serviceCommandSpi)
        .values({ serviceCommandId: cmd.id, spiId: target.id, triggerStage: dto.triggerStage, executionSequence: dto.executionSequence, spiOperation: dto.spiOperation })
        .returning();
      return row;
    } catch (err) {
      throw conflict(err, `${dto.triggerStage} already has a call with sequence ${dto.executionSequence}`);
    }
  }

  async updateCommandSpi(id: string, dto: StatusDto) {
    const [row] = await this.db.update(serviceCommandSpi).set({ status: dto.status }).where(eq(serviceCommandSpi.id, id)).returning();
    if (!row) throw new NotFoundException('command SPI not found');
    return row;
  }

  // ------------------------------------------------------------------ tiers

  /**
   * Creates a tier with its amount rules and balance movements. Validated before saving: formulas
   * only use AMOUNT or earlier results, movement amount types are priced, SPECIFIC stocks exist in
   * the service currency, and the rules price cleanly at the edges of the range.
   */
  async createTier(code: string, type: CommandType, dto: CreateTierDto) {
    const svc = await this.findService(code);
    const cmd = await this.findCommand(code, type, svc.id);
    const known = new Set((await this.listAmountTypes()).map((a) => a.code));
    const rules = dto.rules.map((r) => this.toRule(r));
    const problems = validateRules(rules, known);

    const priced = new Set(['AMOUNT', ...rules.map((r) => r.amountType)]);
    const seq = new Set<number>();
    for (const m of dto.movements) {
      const where = `movement ${m.movementSequence}`;
      if (seq.has(m.movementSequence)) problems.push(`${where}: movement_sequence is used twice`);
      seq.add(m.movementSequence);
      if (!known.has(m.amountType)) problems.push(`${where}: unknown amount type ${m.amountType}`);
      else if (!priced.has(m.amountType)) problems.push(`${where}: ${m.amountType} has no rule in this tier, so it would always be 0`);
      if ((m.fromStockRole === 'SPECIFIC') !== !!m.fromStockId) problems.push(`${where}: fromStockId is required exactly when fromStockRole is SPECIFIC`);
      if ((m.toStockRole === 'SPECIFIC') !== !!m.toStockId) problems.push(`${where}: toStockId is required exactly when toStockRole is SPECIFIC`);
    }

    const specificIds = dto.movements.flatMap((m) => [m.fromStockId, m.toStockId]).filter((id): id is string => !!id);
    const stocks = await this.profiles.stocks(specificIds);
    for (const id of new Set(specificIds)) {
      const s = stocks.find((x) => x.id === id);
      if (!s) problems.push(`stock ${id} does not exist`);
      else if (s.currency !== svc.currency) problems.push(`stock ${s.stockNumber} is ${s.currency}, the service is ${svc.currency}`);
      else if (!canReceive(s)) problems.push(`stock ${s.stockNumber} is closed`);
    }

    if (!problems.length) {
      for (const edge of this.edges(dto.minAmount, dto.maxAmount)) {
        try {
          const amounts = computeAmounts(edge, rules);
          resolveMovements(dto.movements.map((m) => ({ ...m, fromStockId: m.fromStockId ?? null, toStockId: m.toStockId ?? null })), amounts, { payer: 'payer', payee: 'payee' });
        } catch (err) {
          problems.push(`at amount ${toDecimal(edge)}: ${(err as Error).message}`);
        }
      }
    }
    if (problems.length) throw new BadRequestException({ message: 'tier configuration is invalid', problems });

    try {
      const id = await this.db.transaction(async (tx) => {
        const [tier] = await tx
          .insert(tierConfig)
          .values({ serviceCommandId: cmd.id, minAmount: dto.minAmount ?? null, maxAmount: dto.maxAmount ?? null })
          .returning();
        if (rules.length) await tx.insert(tierAmountRule).values(rules.map((r) => ({ ...r, tierConfigId: tier.id })));
        await tx.insert(balanceMovementConfig).values(
          dto.movements.map((m) => ({ ...m, tierConfigId: tier.id, fromStockId: m.fromStockId ?? null, toStockId: m.toStockId ?? null })),
        );
        return tier.id;
      });
      return this.getTier(id);
    } catch (err) {
      throw conflict(err, 'tier already exists');
    }
  }

  /** Tiers are immutable once created (orders reference them); they can only be switched off. */
  async updateTier(id: string, dto: StatusDto) {
    try {
      const [row] = await this.db.update(tierConfig).set({ status: dto.status, updatedAt: new Date() }).where(eq(tierConfig.id, id)).returning();
      if (!row) throw new NotFoundException('tier not found');
      return row;
    } catch (err) {
      throw conflict(err, 'tier conflict');
    }
  }

  async getTier(id: string) {
    const [tier] = await this.db.select().from(tierConfig).where(eq(tierConfig.id, id));
    if (!tier) throw new NotFoundException('tier not found');
    return { ...tier, ...(await this.tierDetails(id)) };
  }

  /** Dry run: the amounts and movements an order of this amount would get from this tier. */
  async previewTier(id: string, amount: string) {
    const tier = await this.getTier(id);
    const values = this.amountsFor(toMinor(amount), tier.rules);
    const movements = resolveMovements(tier.movements, values, { payer: 'PAYER', payee: 'PAYEE' });
    return {
      tierId: id,
      amounts: Object.fromEntries([...values].map(([k, v]) => [k, toDecimal(v)])),
      movements: movements.map((m) => ({ ...m, amount: toDecimal(m.amount) })),
    };
  }

  // ------------------------------------------------------------------ used by orders

  async resolveForOrder(code: string, type: CommandType) {
    const svc = await this.findService(code);
    const [group] = await this.db.select().from(serviceGroup).where(eq(serviceGroup.id, svc.serviceGroupId));
    if (svc.status !== 'ACTIVE' || group.status !== 'ACTIVE') {
      throw new UnprocessableEntityException(`service ${code} is not active`);
    }
    const cmd = await this.findCommand(code, type, svc.id);
    if (cmd.status !== 'ACTIVE') throw new UnprocessableEntityException(`${type} is not active for ${code}`);
    return { service: svc, command: cmd };
  }

  /** The ACTIVE tier whose [min, max) range contains the amount. */
  async matchTier(db: Db, cmd: ServiceCommand, amountMinor: bigint) {
    const amount = toDecimal(amountMinor);
    const [tier] = await db
      .select()
      .from(tierConfig)
      .where(
        and(
          eq(tierConfig.serviceCommandId, cmd.id),
          eq(tierConfig.status, 'ACTIVE'),
          or(isNull(tierConfig.minAmount), lte(tierConfig.minAmount, amount)),
          or(isNull(tierConfig.maxAmount), gt(tierConfig.maxAmount, amount)),
        ),
      );
    if (!tier) throw new UnprocessableEntityException(`no active ${cmd.commandType} tier covers amount ${amount}`);
    return { tier, ...(await this.tierDetails(tier.id, db)) };
  }

  amountsFor(amountMinor: bigint, rules: AmountRule[]) {
    try {
      return computeAmounts(amountMinor, rules);
    } catch (err) {
      throw new UnprocessableEntityException((err as Error).message);
    }
  }

  /** The command's active SPI calls (with active SPIs), in stage and sequence order. */
  async spiCalls(commandId: string): Promise<SpiCall[]> {
    const rows = await this.commandSpiRows(commandId);
    return rows
      .filter((r) => r.status === 'ACTIVE' && r.spi.status === 'ACTIVE')
      .map((r) => ({
        stage: r.triggerStage,
        sequence: r.executionSequence,
        spiCode: r.spi.code,
        spiType: r.spi.spiType,
        operation: r.spiOperation,
        timeoutMs: r.spi.timeoutMs,
        maxRetries: r.spi.maxRetries,
      }));
  }

  // ------------------------------------------------------------------ helpers

  private async tierDetails(tierId: string, db: Db = this.db) {
    const [rules, movements] = await Promise.all([
      db.select().from(tierAmountRule).where(eq(tierAmountRule.tierConfigId, tierId)).orderBy(asc(tierAmountRule.calcSequence)),
      db.select().from(balanceMovementConfig).where(eq(balanceMovementConfig.tierConfigId, tierId)).orderBy(asc(balanceMovementConfig.movementSequence)),
    ]);
    return { rules, movements };
  }

  private async commandSpiRows(commandId: string) {
    const rows = await this.db
      .select({
        id: serviceCommandSpi.id,
        triggerStage: serviceCommandSpi.triggerStage,
        executionSequence: serviceCommandSpi.executionSequence,
        spiOperation: serviceCommandSpi.spiOperation,
        status: serviceCommandSpi.status,
        spi: {
          code: spi.code,
          name: spi.name,
          spiType: spi.spiType,
          status: spi.status,
          timeoutMs: sql<number>`coalesce(${spiExternalConfig.timeoutMs}, ${spiInternalConfig.timeoutMs})`,
          maxRetries: sql<number>`coalesce(${spiExternalConfig.maxRetries}, 0)`,
        },
      })
      .from(serviceCommandSpi)
      .innerJoin(spi, eq(spi.id, serviceCommandSpi.spiId))
      .leftJoin(spiInternalConfig, eq(spiInternalConfig.spiId, spi.id))
      .leftJoin(spiExternalConfig, eq(spiExternalConfig.spiId, spi.id))
      .where(eq(serviceCommandSpi.serviceCommandId, commandId));
    const stageOrder = ['PRE_PAYMENT', 'POST_PAYMENT', 'NOTIFICATION'];
    return rows.sort((a, b) => stageOrder.indexOf(a.triggerStage) - stageOrder.indexOf(b.triggerStage) || a.executionSequence - b.executionSequence);
  }

  private toRule(r: CreateTierDto['rules'][number]): AmountRule {
    return {
      amountType: r.amountType,
      calcSequence: r.calcSequence,
      calcMethod: r.calcMethod,
      baseAmountType: r.baseAmountType ?? null,
      fixedValue: r.fixedValue ?? null,
      percentage: r.percentage ?? null,
      formulaExpression: r.formulaExpression ?? null,
      minValue: r.minValue ?? null,
      maxValue: r.maxValue ?? null,
    };
  }

  /** Amounts worth pricing before a tier is saved: the range edges (max is exclusive) and a midpoint. */
  private edges(min?: string, max?: string): bigint[] {
    const lo = min ? toMinor(min) : 1n;
    const hi = max ? toMinor(max) - 1n : lo * 1000n + 100_000n;
    return [...new Set([lo > 0n ? lo : 1n, hi, (lo + hi) / 2n])].filter((a) => a > 0n);
  }

  private async findService(code: string) {
    const [row] = await this.db.select().from(service).where(eq(service.code, code));
    if (!row) throw new NotFoundException(`service ${code} not found`);
    return row;
  }

  private async findCommand(code: string, type: CommandType, serviceId?: string) {
    const id = serviceId ?? (await this.findService(code)).id;
    const [row] = await this.db
      .select()
      .from(serviceCommand)
      .where(and(eq(serviceCommand.serviceId, id), eq(serviceCommand.commandType, type)));
    if (!row) throw new NotFoundException(`${type} is not configured for ${code}`);
    return row;
  }
}
