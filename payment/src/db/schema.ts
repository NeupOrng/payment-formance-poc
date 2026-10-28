// Payment Engine schema: configuration (service groups → services → commands → tiers with amount
// rules and balance movements, plus the SPIs commands call) and transactions (payment orders with
// their amounts, resolved balance movements, ledger transactions and status history).
// Stocks and profiles live in the Profile Service: those ids are logical references (no FK).
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const CURRENCIES = ['USD', 'KHR'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const configStatus = pgEnum('config_status', ['ACTIVE', 'INACTIVE']);
export const commandType = pgEnum('command_type', ['PAYMENT', 'REFUND', 'CANCEL']);
export const spiType = pgEnum('spi_type', ['INTERNAL', 'EXTERNAL']);
export const spiProtocol = pgEnum('spi_protocol', ['REST', 'SOAP', 'ISO8583', 'ISO20022']);
export const spiAuthType = pgEnum('spi_auth_type', ['NONE', 'API_KEY', 'BASIC', 'OAUTH2', 'MTLS']);
export const spiTrigger = pgEnum('spi_trigger', ['PRE_PAYMENT', 'POST_PAYMENT', 'NOTIFICATION']);
export const calcMethod = pgEnum('calc_method', ['FIXED', 'FORMULA']);
export const stockRole = pgEnum('stock_role', ['PAYER', 'PAYEE', 'SPECIFIC']);
export const paymentStatus = pgEnum('payment_status', [
  'PENDING', // created, awaiting customer authentication
  'PROCESSING', // authenticated, balance movements in progress
  'COMPLETED', // all movements posted
  'FAILED', // rejected or failed; status_reason_code says why
  'CANCELLED', // cancelled before completion
  'REVERSED', // completed, then fully refunded or reversed
]);
export const movementStatus = pgEnum('movement_status', ['PENDING', 'POSTED', 'FAILED', 'REVERSED']);
// Added for the saga: the Formance transactions behind an order (not in the original plan).
export const ledgerStep = pgEnum('ledger_step', ['RESERVE', 'SETTLE', 'REVERT', 'RELEASE']);
export const ledgerTxStatus = pgEnum('ledger_tx_status', ['PLANNED', 'POSTED', 'REJECTED']);

export type CommandType = (typeof commandType.enumValues)[number];
export type PaymentStatus = (typeof paymentStatus.enumValues)[number];
export type SpiTrigger = (typeof spiTrigger.enumValues)[number];
export type StockRole = (typeof stockRole.enumValues)[number];
export type LedgerStep = (typeof ledgerStep.enumValues)[number];

const money = (name: string) => numeric(name, { precision: 20, scale: 2 });
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

// ------------------------------------------------------------------------------------ configuration

/** Amount types are data, so new ones can be added by config. Codes are formula-safe variables. */
export const amountType = pgTable(
  'amount_type',
  {
    code: varchar('code', { length: 30 }).primaryKey(), // e.g. FEE, TAX, SELLING_PRICE
    name: varchar('name', { length: 100 }).notNull(),
  },
  (t) => [check('chk_amount_type_code', sql`${t.code} ~ '^[A-Z][A-Z0-9_]*$'`)],
);

/** Groups related services, e.g. Transfers, Bill payments, QR payments. */
export const serviceGroup = pgTable('service_group', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 140 }).notNull(),
  description: varchar('description', { length: 255 }),
  status: configStatus('status').notNull().default('ACTIVE'), // INACTIVE turns off every service in the group
  ...timestamps,
});

/** A payable product inside a service group, e.g. BAKONG_TRANSFER. Each service works in exactly one currency. */
export const service = pgTable(
  'service',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceGroupId: uuid('service_group_id')
      .notNull()
      .references(() => serviceGroup.id),
    code: varchar('code', { length: 50 }).notNull().unique(), // e.g. BAKONG_TRANSFER
    name: varchar('name', { length: 140 }).notNull(),
    currency: char('currency', { length: 3 }).notNull(), // one currency per service (ISO 4217)
    status: configStatus('status').notNull().default('ACTIVE'),
    ...timestamps,
  },
  (t) => [unique('uq_service_currency').on(t.id, t.currency)], // lets orders reference (service_id, currency)
);

/** An action a service supports: PAYMENT, REFUND or CANCEL. Each command has its own tiers and SPI calls. */
export const serviceCommand = pgTable(
  'service_command',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => service.id),
    commandType: commandType('command_type').notNull(),
    status: configStatus('status').notNull().default('ACTIVE'),
    ...timestamps,
  },
  (t) => [unique('uq_service_command').on(t.serviceId, t.commandType)],
);

/** SPI (service provider interface): one row per provider; its type decides which config table holds the details. */
export const spi = pgTable(
  'spi',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 50 }).notNull().unique(), // e.g. CORE_BANKING, BAKONG, EDC_BILLER
    name: varchar('name', { length: 140 }).notNull(),
    spiType: spiType('spi_type').notNull(),
    status: configStatus('status').notNull().default('ACTIVE'),
    ...timestamps,
  },
  (t) => [unique('uq_spi_type').on(t.id, t.spiType)], // lets config tables pin the type
);

/** Internal provider: a handler inside our own platform. */
export const spiInternalConfig = pgTable(
  'spi_internal_config',
  {
    spiId: uuid('spi_id').primaryKey(),
    spiType: spiType('spi_type').notNull().default('INTERNAL'),
    handlerName: varchar('handler_name', { length: 140 }).notNull(), // service / bean / queue that executes the call
    timeoutMs: integer('timeout_ms').notNull().default(10_000),
  },
  (t) => [
    foreignKey({ name: 'fk_spi_internal', columns: [t.spiId, t.spiType], foreignColumns: [spi.id, spi.spiType] }),
    check('chk_spi_internal_type', sql`${t.spiType} = 'INTERNAL'`),
    check('chk_spi_internal_timeout', sql`${t.timeoutMs} > 0`),
  ],
);

/** External provider: a third-party system. Secrets are never stored here; credential_ref names the secret. */
export const spiExternalConfig = pgTable(
  'spi_external_config',
  {
    spiId: uuid('spi_id').primaryKey(),
    spiType: spiType('spi_type').notNull().default('EXTERNAL'),
    baseUrl: varchar('base_url', { length: 500 }).notNull(),
    protocol: spiProtocol('protocol').notNull(),
    authType: spiAuthType('auth_type').notNull(),
    credentialRef: varchar('credential_ref', { length: 200 }), // vault key / secret name
    timeoutMs: integer('timeout_ms').notNull().default(30_000),
    maxRetries: smallint('max_retries').notNull().default(0),
  },
  (t) => [
    foreignKey({ name: 'fk_spi_external', columns: [t.spiId, t.spiType], foreignColumns: [spi.id, spi.spiType] }),
    check('chk_spi_external_type', sql`${t.spiType} = 'EXTERNAL'`),
    check('chk_spi_credential', sql`(${t.authType} = 'NONE') = (${t.credentialRef} IS NULL)`),
    check('chk_spi_external_timeout', sql`${t.timeoutMs} > 0`),
    check('chk_spi_external_retries', sql`${t.maxRetries} >= 0`),
  ],
);

/**
 * Which SPIs a command calls, at which stage, in which order.
 *   PRE_PAYMENT:  before balances move; a failure fails the order (e.g. validate biller account)
 *   POST_PAYMENT: after balances move; a failure reverts the movements (e.g. confirm to biller)
 *   NOTIFICATION: last, best effort; a failure does not change the order (e.g. push, SMS)
 */
export const serviceCommandSpi = pgTable(
  'service_command_spi',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceCommandId: uuid('service_command_id')
      .notNull()
      .references(() => serviceCommand.id),
    spiId: uuid('spi_id')
      .notNull()
      .references(() => spi.id),
    triggerStage: spiTrigger('trigger_stage').notNull(),
    executionSequence: smallint('execution_sequence').notNull(), // order within the stage
    spiOperation: varchar('spi_operation', { length: 200 }).notNull(), // e.g. 'POST /confirmations' or 'validateAccount'
    status: configStatus('status').notNull().default('ACTIVE'),
  },
  (t) => [unique('uq_command_spi_sequence').on(t.serviceCommandId, t.triggerStage, t.executionSequence)],
);

/**
 * The order AMOUNT picks the active tier whose range contains it. min_amount is inclusive,
 * max_amount exclusive; NULL = no limit on that side. Active ranges may not overlap (EXCLUDE
 * constraint in a custom migration).
 */
export const tierConfig = pgTable(
  'tier_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceCommandId: uuid('service_command_id')
      .notNull()
      .references(() => serviceCommand.id),
    minAmount: money('min_amount'),
    maxAmount: money('max_amount'),
    status: configStatus('status').notNull().default('ACTIVE'),
    ...timestamps,
  },
  (t) => [
    check(
      'chk_tier_range',
      sql`(${t.minAmount} IS NULL OR ${t.minAmount} >= 0) AND (${t.minAmount} IS NULL OR ${t.maxAmount} IS NULL OR ${t.maxAmount} > ${t.minAmount})`,
    ),
  ],
);

/**
 * How each amount type is calculated inside a tier.
 *   FIXED:   fixed_value + base_amount_type * percentage / 100   e.g. FEE = 5% of AMOUNT, or FEE = 0.50
 *   FORMULA: formula_expression                                  e.g. SELLING_PRICE = 'FEE + AMOUNT'
 * min_value / max_value cap the result of either method. Results round half up to 2 decimals.
 */
export const tierAmountRule = pgTable(
  'tier_amount_rule',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tierConfigId: uuid('tier_config_id')
      .notNull()
      .references(() => tierConfig.id),
    amountType: varchar('amount_type', { length: 30 })
      .notNull()
      .references(() => amountType.code),
    calcSequence: smallint('calc_sequence').notNull(), // a rule may only use amount types calculated earlier
    calcMethod: calcMethod('calc_method').notNull(),
    baseAmountType: varchar('base_amount_type', { length: 30 }).references(() => amountType.code),
    fixedValue: money('fixed_value'),
    percentage: numeric('percentage', { precision: 9, scale: 6 }), // 5 = 5%
    formulaExpression: varchar('formula_expression', { length: 500 }),
    minValue: money('min_value'),
    maxValue: money('max_value'),
  },
  (t) => [
    unique('uq_tier_amount_type').on(t.tierConfigId, t.amountType),
    unique('uq_tier_calc_sequence').on(t.tierConfigId, t.calcSequence),
    check('chk_rule_not_amount', sql`${t.amountType} <> 'AMOUNT'`),
    check(
      'chk_rule_fixed',
      sql`${t.calcMethod} <> 'FIXED' OR (
        ${t.formulaExpression} IS NULL
        AND (${t.fixedValue} IS NOT NULL OR ${t.percentage} IS NOT NULL)
        AND (${t.percentage} IS NULL) = (${t.baseAmountType} IS NULL)
        AND (${t.baseAmountType} IS NULL OR ${t.baseAmountType} <> ${t.amountType})
      )`,
    ),
    check(
      'chk_rule_formula',
      sql`${t.calcMethod} <> 'FORMULA' OR (
        ${t.formulaExpression} IS NOT NULL
        AND ${t.formulaExpression} ~ '^[A-Z0-9_ .+\\-*/()]+$'
        AND ${t.baseAmountType} IS NULL AND ${t.fixedValue} IS NULL AND ${t.percentage} IS NULL
      )`,
    ),
    check('chk_rule_minmax', sql`${t.minValue} IS NULL OR ${t.maxValue} IS NULL OR ${t.maxValue} >= ${t.minValue}`),
  ],
);

/**
 * Which amount type moves from which stock to which stock, for a tier. PAYER / PAYEE resolve to the
 * order's stocks; SPECIFIC uses the stock id set here.
 */
export const balanceMovementConfig = pgTable(
  'balance_movement_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tierConfigId: uuid('tier_config_id')
      .notNull()
      .references(() => tierConfig.id),
    movementSequence: smallint('movement_sequence').notNull(), // posting order
    amountType: varchar('amount_type', { length: 30 })
      .notNull()
      .references(() => amountType.code),
    fromStockRole: stockRole('from_stock_role').notNull(),
    fromStockId: uuid('from_stock_id'),
    toStockRole: stockRole('to_stock_role').notNull(),
    toStockId: uuid('to_stock_id'),
  },
  (t) => [
    unique('uq_movement_sequence').on(t.tierConfigId, t.movementSequence),
    check('chk_from_stock', sql`(${t.fromStockRole} = 'SPECIFIC') = (${t.fromStockId} IS NOT NULL)`),
    check('chk_to_stock', sql`(${t.toStockRole} = 'SPECIFIC') = (${t.toStockId} IS NOT NULL)`),
    check(
      'chk_not_same_stock',
      sql`NOT (${t.fromStockRole} = ${t.toStockRole} AND ${t.fromStockRole} <> 'SPECIFIC')
        AND (${t.fromStockId} IS NULL OR ${t.toStockId} IS NULL OR ${t.fromStockId} <> ${t.toStockId})`,
    ),
  ],
);

// ------------------------------------------------------------------------------------- transactions

/**
 * One request to move money: it executes one service command, records the tier it matched, the
 * payer and payee stocks, the order amount and its lifecycle status. REFUND / CANCEL orders point
 * back to the order they undo through original_order_id.
 */
export const paymentOrders = pgTable(
  'payment_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderReference: varchar('order_reference', { length: 35 }).notNull().unique(), // customer-facing reference
    idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull(), // sent by the app to prevent double-submit
    externalReference: varchar('external_reference', { length: 64 }), // e.g. bill number; network / core reference

    serviceId: uuid('service_id')
      .notNull()
      .references(() => service.id),
    serviceCommandId: uuid('service_command_id')
      .notNull()
      .references(() => serviceCommand.id),
    tierConfigId: uuid('tier_config_id').references(() => tierConfig.id), // tier matched by amount
    originalOrderId: uuid('original_order_id').references((): AnyPgColumn => paymentOrders.id), // REFUND / CANCEL

    status: paymentStatus('status').notNull().default('PENDING'),
    statusReasonCode: varchar('status_reason_code', { length: 20 }), // e.g. INSUFFICIENT_FUNDS, LIMIT_EXCEEDED

    customerId: uuid('customer_id').notNull(), // payer's profile (Profile Service)
    payerAccountId: uuid('payer_account_id').notNull(), // payer stock (Profile Service)
    payerName: varchar('payer_name', { length: 140 }).notNull(), // snapshot for receipts
    payeeAccountId: uuid('payee_account_id').notNull(), // payee stock (Profile Service)
    payeeName: varchar('payee_name', { length: 140 }), // snapshot for receipts

    amount: money('amount').notNull(), // = the AMOUNT amount type
    currency: char('currency', { length: 3 }).notNull(),

    ...timestamps,
    version: integer('version').notNull().default(0), // optimistic locking
  },
  (t) => [
    unique('uq_idempotency').on(t.customerId, t.idempotencyKey),
    check('chk_not_self_reference', sql`${t.originalOrderId} <> ${t.id}`),
    check('chk_order_amount', sql`${t.amount} > 0`),
    foreignKey({
      name: 'fk_po_service_currency',
      columns: [t.serviceId, t.currency],
      foreignColumns: [service.id, service.currency],
    }),
    index('idx_po_customer_created').on(t.customerId, t.createdAt.desc()),
    index('idx_po_payer_created').on(t.payerAccountId, t.createdAt.desc()),
    index('idx_po_payee_created').on(t.payeeAccountId, t.createdAt.desc()),
    index('idx_po_in_flight').on(t.status, t.updatedAt).where(sql`${t.status} IN ('PENDING', 'PROCESSING')`),
    index('idx_po_external_reference').on(t.externalReference),
    index('idx_po_original_order').on(t.originalOrderId).where(sql`${t.originalOrderId} IS NOT NULL`),
  ],
);

/** Amounts calculated for an order, one row per amount type (currency = order currency). */
export const paymentOrderAmount = pgTable(
  'payment_order_amount',
  {
    paymentOrderId: uuid('payment_order_id')
      .notNull()
      .references(() => paymentOrders.id),
    amountType: varchar('amount_type', { length: 30 })
      .notNull()
      .references(() => amountType.code),
    amount: money('amount').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.paymentOrderId, t.amountType] }),
    check('chk_order_amount_non_negative', sql`${t.amount} >= 0`),
  ],
);

/** Stock-to-stock movements resolved for an order (currency = order currency). */
export const paymentOrderBalanceMovement = pgTable(
  'payment_order_balance_movement',
  {
    paymentOrderId: uuid('payment_order_id')
      .notNull()
      .references(() => paymentOrders.id),
    movementSequence: smallint('movement_sequence').notNull(),
    amountType: varchar('amount_type', { length: 30 })
      .notNull()
      .references(() => amountType.code),
    amount: money('amount').notNull(),
    fromStockId: uuid('from_stock_id').notNull(),
    toStockId: uuid('to_stock_id').notNull(),
    status: movementStatus('status').notNull().default('PENDING'),
    coreReference: varchar('core_reference', { length: 64 }), // posting reference returned by the ledger
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.paymentOrderId, t.movementSequence] }),
    check('chk_movement_amount', sql`${t.amount} > 0`),
    check('chk_movement_stocks', sql`${t.fromStockId} <> ${t.toStockId}`),
    index('idx_pobm_pending').on(t.createdAt).where(sql`${t.status} = 'PENDING'`),
  ],
);

/**
 * Added for the saga (not in the original plan): the Formance transactions behind an order.
 *   RESERVE: payer / payee money → per-order hold accounts (`holds:{stockNumber}:{orderId}`)
 *   SETTLE:  the balance movements, paid from the holds
 *   REVERT:  compensation for SETTLE when a POST_PAYMENT SPI fails (Formance revert)
 *   RELEASE: compensation for RESERVE — the holds go back to their stocks
 * Postings carry the stock ids and amount types Formance does not keep (posting N = postings[N]).
 */
export type PlannedPosting = {
  source: string;
  destination: string;
  amount: string; // decimal string, e.g. "21.00"
  fromStockId: string | null;
  toStockId: string | null;
  amountType: string | null;
  movementSequence: number | null;
  overdraft?: boolean;
};

export const paymentOrderLedgerTx = pgTable(
  'payment_order_ledger_tx',
  {
    paymentOrderId: uuid('payment_order_id')
      .notNull()
      .references(() => paymentOrders.id),
    step: ledgerStep('step').notNull(),
    postings: jsonb('postings').$type<PlannedPosting[]>().notNull(),
    numscript: text('numscript'),
    status: ledgerTxStatus('status').notNull().default('PLANNED'),
    ledgerTxId: bigint('ledger_tx_id', { mode: 'bigint' }),
    failureReason: varchar('failure_reason', { length: 64 }),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.paymentOrderId, t.step] })],
);

/** Append-only audit trail of status changes. */
export const paymentOrderStatusHistory = pgTable(
  'payment_order_status_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    paymentOrderId: uuid('payment_order_id')
      .notNull()
      .references(() => paymentOrders.id),
    fromStatus: paymentStatus('from_status'),
    toStatus: paymentStatus('to_status').notNull(),
    reasonCode: varchar('reason_code', { length: 20 }),
    changedBy: varchar('changed_by', { length: 64 }).notNull(), // user id, service name, or 'SYSTEM'
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_posh_order').on(t.paymentOrderId, t.changedAt)],
);

export type Service = typeof service.$inferSelect;
export type ServiceCommand = typeof serviceCommand.$inferSelect;
export type TierConfig = typeof tierConfig.$inferSelect;
export type TierAmountRule = typeof tierAmountRule.$inferSelect;
export type BalanceMovementConfig = typeof balanceMovementConfig.$inferSelect;
export type PaymentOrder = typeof paymentOrders.$inferSelect;
