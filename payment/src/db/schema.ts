import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const CURRENCIES = ['USD', 'KHR'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const SERVICE_STATUSES = ['active', 'suspended', 'inactive'] as const;
export const COMMANDS = ['payment', 'refund', 'cancel'] as const;
export type Command = (typeof COMMANDS)[number];
export const COMMAND_STATUSES = ['active', 'disabled'] as const;

/**
 * What a movement leg carries. `amount` is the request amount; `net_amount` is derived per
 * command (amount + net_amount_add − net_amount_subtract); every other type is calculated
 * from the command's pricing tiers (0 when no tier applies).
 */
export const AMOUNT_TYPES = [
  'amount',
  'selling_price',
  'fee_from_customer',
  'fee_from_partner',
  'commission_to_agent_1',
  'commission_to_partner',
  'withholding_tax',
  'discount',
  'cash_back',
  'cancellation_fee',
  'commission_to_agent_2',
  'purchasing_cost',
  'vat',
  'platform_commission',
  'net_amount',
  'service_charge',
] as const;
export type AmountType = (typeof AMOUNT_TYPES)[number];
/** Amount types that pricing tiers can calculate (all but amount and net_amount). */
export const PRICED_AMOUNT_TYPES = [
  'selling_price',
  'fee_from_customer',
  'fee_from_partner',
  'commission_to_agent_1',
  'commission_to_partner',
  'withholding_tax',
  'discount',
  'cash_back',
  'cancellation_fee',
  'commission_to_agent_2',
  'purchasing_cost',
  'vat',
  'platform_commission',
  'service_charge',
] as const satisfies readonly AmountType[];
export type PricedAmountType = (typeof PRICED_AMOUNT_TYPES)[number];

/** What a percentage is taken of: the request amount, or another priced type (one level deep). */
export const BASE_AMOUNT_TYPES = ['amount', ...PRICED_AMOUNT_TYPES] as const;
export type BaseAmountType = (typeof BASE_AMOUNT_TYPES)[number];

export const CALC_TYPES = ['fixed', 'percent', 'fixed_plus_percent'] as const;
export type CalcType = (typeof CALC_TYPES)[number];

/**
 * Who a movement entry debits or credits:
 * - `{source}` / `{destination}`: the payer / payee customers in the request (for refund and
 *   cancel: those of the original payment);
 * - `@world`: money entering or leaving the system;
 * - a specific account path such as `platform:fees:{service}`. `{service}` is replaced by the
 *   lower-case service code and `:usd` / `:khr` is appended for the transaction currency.
 */
export const PARTY_ACCOUNTS = ['{source}', '{destination}', '@world'] as const;
export const ACCOUNT_PATH_PATTERN = /^[a-z0-9_]+(:([a-z0-9_]+|\{service\}))*$/;
export const ENTRY_SIDES = ['debit', 'credit'] as const;
export type EntrySide = (typeof ENTRY_SIDES)[number];

export const TRANSFER_TYPES = ['payment', 'refund', 'cancel', 'topup'] as const;
export type TransferType = (typeof TRANSFER_TYPES)[number];
export const TRANSFER_STATUSES = ['pending', 'posted', 'failed', 'reversed'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];
export const OUTBOX_STATUSES = ['queued', 'done', 'dead'] as const;

const money = (name: string) => bigint(name, { mode: 'bigint' });
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};
const inList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v}'`).join(', '));

export const services = pgTable(
  'services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceCode: text('service_code').notNull().unique(),
    serviceName: text('service_name').notNull(),
    status: text('status', { enum: SERVICE_STATUSES }).notNull().default('active'),
    ...timestamps,
  },
  (t) => [
    check('services_status_check', sql`${t.status} in (${inList(SERVICE_STATUSES)})`),
    check('services_code_check', sql`${t.serviceCode} ~ '^[A-Z0-9_]{2,40}$'`),
  ],
);

export const serviceCommands = pgTable(
  'service_commands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id),
    command: text('command', { enum: COMMANDS }).notNull(),
    status: text('status', { enum: COMMAND_STATUSES }).notNull().default('active'),
    allowPartial: boolean('allow_partial').notNull().default(false),
    maxAgeMinutes: integer('max_age_minutes'),
    // net_amount = amount + Σ(net_amount_add) − Σ(net_amount_subtract)
    netAmountAdd: text('net_amount_add').array().$type<PricedAmountType[]>().notNull().default(sql`'{}'`),
    netAmountSubtract: text('net_amount_subtract').array().$type<PricedAmountType[]>().notNull().default(sql`'{}'`),
    ...timestamps,
  },
  (t) => [
    unique('service_commands_service_command_unique').on(t.serviceId, t.command),
    check('service_commands_command_check', sql`${t.command} in (${inList(COMMANDS)})`),
    check('service_commands_status_check', sql`${t.status} in (${inList(COMMAND_STATUSES)})`),
    check(
      'service_commands_net_types_check',
      sql`${t.netAmountAdd} <@ array[${inList(PRICED_AMOUNT_TYPES)}]::text[] and ${t.netAmountSubtract} <@ array[${inList(PRICED_AMOUNT_TYPES)}]::text[]`,
    ),
  ],
);

// One row per amount type, currency and band of the request amount. Non-overlap is enforced by an
// EXCLUDE constraint in a custom migration. Percentages are of `base_amount_type` (default: amount).
export const servicePricingTiers = pgTable(
  'service_pricing_tiers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceCommandId: uuid('service_command_id')
      .notNull()
      .references(() => serviceCommands.id),
    amountType: text('amount_type', { enum: PRICED_AMOUNT_TYPES }).notNull(),
    currency: text('currency', { enum: CURRENCIES }).notNull(),
    minAmount: money('min_amount').notNull().default(sql`0`),
    maxAmount: money('max_amount'),
    calcType: text('calc_type', { enum: CALC_TYPES }).notNull(),
    baseAmountType: text('base_amount_type', { enum: BASE_AMOUNT_TYPES }).notNull().default('amount'),
    // value = (include_base ? base : 0) + clamp(fixed + base × percent, min, max)
    // e.g. selling_price = amount + amount × 5%
    includeBase: boolean('include_base').notNull().default(false),
    fixedAmount: money('fixed_amount').notNull().default(sql`0`),
    percentBps: integer('percent_bps').notNull().default(0),
    minValue: money('min_value'),
    maxValue: money('max_value'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('service_pricing_tiers_lookup_idx').on(t.serviceCommandId, t.currency, t.amountType),
    check('service_pricing_tiers_amount_type_check', sql`${t.amountType} in (${inList(PRICED_AMOUNT_TYPES)})`),
    check('service_pricing_tiers_currency_check', sql`${t.currency} in (${inList(CURRENCIES)})`),
    check('service_pricing_tiers_calc_type_check', sql`${t.calcType} in (${inList(CALC_TYPES)})`),
    check(
      'service_pricing_tiers_base_check',
      sql`${t.baseAmountType} in (${inList(BASE_AMOUNT_TYPES)}) and ${t.baseAmountType} <> ${t.amountType}`,
    ),
    check(
      'service_pricing_tiers_amounts_check',
      sql`${t.minAmount} >= 0 and (${t.maxAmount} is null or ${t.maxAmount} >= ${t.minAmount}) and ${t.fixedAmount} >= 0 and ${t.percentBps} between 0 and 10000`,
    ),
    check(
      'service_pricing_tiers_effective_check',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  ],
);

/**
 * A command's balance movement, written as debit and credit entries (double entry). Saved only when
 * Σ debits = Σ credits for every pricing band; checked again before every posting.
 */
export const serviceMovementEntries = pgTable(
  'service_movement_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceCommandId: uuid('service_command_id')
      .notNull()
      .references(() => serviceCommands.id, { onDelete: 'cascade' }),
    entryNo: integer('entry_no').notNull(),
    side: text('side', { enum: ENTRY_SIDES }).notNull(),
    account: text('account').notNull(),
    amountType: text('amount_type', { enum: AMOUNT_TYPES }).notNull(),
    // Only for specific (platform-owned) accounts, e.g. a marketing budget paying cash back.
    allowOverdraft: boolean('allow_overdraft').notNull().default(false),
  },
  (t) => [
    unique('service_movement_entries_command_entry_unique').on(t.serviceCommandId, t.entryNo),
    check('service_movement_entries_side_check', sql`${t.side} in (${inList(ENTRY_SIDES)})`),
    check('service_movement_entries_amount_type_check', sql`${t.amountType} in (${inList(AMOUNT_TYPES)})`),
    check(
      'service_movement_entries_overdraft_check',
      sql`not ${t.allowOverdraft} or ${t.account} not in (${inList(PARTY_ACCOUNTS)})`,
    ),
  ],
);

// One row per business money movement; `id` is sent to Formance as `reference` and Idempotency-Key.
// Customer accounts live in the customer service, so they are referenced by id without a foreign key.
export const transfers = pgTable(
  'transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    type: text('type', { enum: TRANSFER_TYPES }).notNull(),
    status: text('status', { enum: TRANSFER_STATUSES }).notNull().default('pending'),
    serviceId: uuid('service_id').references(() => services.id),
    serviceCommandId: uuid('service_command_id').references(() => serviceCommands.id),
    originalTransferId: uuid('original_transfer_id').references((): AnyPgColumn => transfers.id),
    sourceCustomerId: uuid('source_customer_id'),
    sourceAccountId: uuid('source_account_id'),
    destinationCustomerId: uuid('destination_customer_id'),
    destinationAccountId: uuid('destination_account_id'),
    currency: text('currency', { enum: CURRENCIES }).notNull(),
    asset: text('asset').notNull(),
    amount: money('amount').notNull(),
    // Net effect of the ledger postings on each customer's account (+ in, − out).
    sourceNet: money('source_net'),
    destinationNet: money('destination_net'),
    ledgerTxId: money('ledger_tx_id'),
    externalRef: text('external_ref'),
    failureReason: text('failure_reason'),
    metadata: jsonb('metadata').$type<Record<string, string>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    unique('transfers_type_external_ref_unique').on(t.type, t.externalRef),
    index('transfers_source_created_idx').on(t.sourceCustomerId, t.createdAt.desc()),
    index('transfers_destination_created_idx').on(t.destinationCustomerId, t.createdAt.desc()),
    index('transfers_original_idx').on(t.originalTransferId),
    check('transfers_type_check', sql`${t.type} in (${inList(TRANSFER_TYPES)})`),
    check('transfers_status_check', sql`${t.status} in (${inList(TRANSFER_STATUSES)})`),
    check('transfers_currency_check', sql`${t.currency} in (${inList(CURRENCIES)})`),
    check('transfers_amount_check', sql`${t.amount} > 0`),
    check(
      'transfers_service_check',
      sql`(${t.type} = 'topup') = (${t.serviceCommandId} is null)`,
    ),
    check(
      'transfers_original_check',
      sql`(${t.type} in ('refund', 'cancel')) = (${t.originalTransferId} is not null)`,
    ),
    check(
      'transfers_parties_check',
      sql`(${t.sourceCustomerId} is null) = (${t.sourceAccountId} is null) and (${t.destinationCustomerId} is null) = (${t.destinationAccountId} is null) and (${t.sourceCustomerId} is not null or ${t.destinationCustomerId} is not null)`,
    ),
  ],
);

/** Every amount type calculated for a transfer, with the tier it came from. */
export const transferAmounts = pgTable(
  'transfer_amounts',
  {
    transferId: uuid('transfer_id')
      .notNull()
      .references(() => transfers.id),
    amountType: text('amount_type', { enum: AMOUNT_TYPES }).notNull(),
    amount: money('amount').notNull(),
    pricingTierId: uuid('pricing_tier_id').references(() => servicePricingTiers.id),
  },
  (t) => [
    primaryKey({ columns: [t.transferId, t.amountType] }),
    check('transfer_amounts_amount_type_check', sql`${t.amountType} in (${inList(AMOUNT_TYPES)})`),
  ],
);

export const transferEvents = pgTable(
  'transfer_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    transferId: uuid('transfer_id')
      .notNull()
      .references(() => transfers.id),
    fromStatus: text('from_status', { enum: TRANSFER_STATUSES }),
    toStatus: text('to_status', { enum: TRANSFER_STATUSES }).notNull(),
    reason: text('reason'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('transfer_events_transfer_idx').on(t.transferId)],
);

/** One planned ledger posting, with the amount types of the debit and credit it settles. */
export type PlannedPosting = {
  source: string;
  destination: string;
  amount: string;
  debitType: AmountType;
  creditType: AmountType;
};

export type LedgerRequest = {
  script: { plain: string; vars: Record<string, string> };
  reference: string;
  metadata: Record<string, string>;
};

// Guarantees every pending transfer reaches the ledger, even after a crash or timeout.
export const ledgerOutbox = pgTable(
  'ledger_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transferId: uuid('transfer_id')
      .notNull()
      .unique()
      .references(() => transfers.id),
    request: jsonb('request').$type<LedgerRequest>().notNull(),
    // Posting N of the ledger transaction = postings[N]; Formance itself does not keep amount types.
    postings: jsonb('postings').$type<PlannedPosting[]>().notNull(),
    status: text('status', { enum: OUTBOX_STATUSES }).notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    ...timestamps,
  },
  (t) => [
    index('ledger_outbox_due_idx').on(t.status, t.nextAttemptAt),
    check('ledger_outbox_status_check', sql`${t.status} in (${inList(OUTBOX_STATUSES)})`),
  ],
);

export type Service = typeof services.$inferSelect;
export type ServiceCommand = typeof serviceCommands.$inferSelect;
export type ServicePricingTier = typeof servicePricingTiers.$inferSelect;
export type ServiceMovementEntry = typeof serviceMovementEntries.$inferSelect;
export type Transfer = typeof transfers.$inferSelect;
