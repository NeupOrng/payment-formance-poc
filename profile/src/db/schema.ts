// Profile Service schema: who holds money (profile), the accounts they hold (account_product) and
// one balance per currency inside each account (stock). Balances are owned by Formance; the stock
// balance columns are a read model kept in step with the stock's Formance accounts (see LedgerSync).
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgSequence,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const CURRENCIES = ['USD', 'KHR'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const profileType = pgEnum('profile_type', [
  'INDIVIDUAL', // customer served by agents
  'AGENT', // cash-in / cash-out agent
  'INTERNAL', // the bank itself; owns fee income, commission expense, suspense …
]);
export const profileStatus = pgEnum('profile_status', ['PENDING_KYC', 'ACTIVE', 'SUSPENDED', 'CLOSED']);
export const productType = pgEnum('product_type', [
  'CURRENT', // INDIVIDUAL: the customer's everyday account (cash-in lands here)
  'AGENT_FLOAT', // AGENT: working e-money used to serve cash-in / cash-out
  'COMMISSION', // AGENT: commissions earned, kept apart from float
  'INTERNAL', // INTERNAL: fee income, commission expense, suspense
]);
export const accountStatus = pgEnum('account_status', ['ACTIVE', 'FROZEN', 'CLOSED']);

export type ProfileType = (typeof profileType.enumValues)[number];
export type ProfileStatus = (typeof profileStatus.enumValues)[number];
export type ProductType = (typeof productType.enumValues)[number];
export type AccountStatus = (typeof accountStatus.enumValues)[number];

export const profileNumberSeq = pgSequence('profile_number_seq', { startWith: 1 });
export const stockNumberSeq = pgSequence('stock_number_seq', { startWith: 1 });

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/** Profile: the customer, agent or bank that holds accounts. */
export const profile = pgTable(
  'profile',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // customer-facing CIF number
    profileNumber: varchar('profile_number', { length: 20 })
      .notNull()
      .unique()
      .default(sql`('CIF' || lpad(nextval('profile_number_seq')::text, 9, '0'))`),
    profileType: profileType('profile_type').notNull(),
    // person's name or registered business name
    fullName: varchar('full_name', { length: 140 }).notNull(),
    // E.164, e.g. +85512345678
    phoneNumber: varchar('phone_number', { length: 20 }).unique(),
    // KYC for customers, KYB for agents
    kycVerified: boolean('kyc_verified').notNull().default(false),
    status: profileStatus('status').notNull().default('PENDING_KYC'),
    ...timestamps,
  },
  (t) => [
    unique('uq_profile_type').on(t.id, t.profileType), // lets accounts pin the owner's type
    check(
      'chk_active_needs_kyc',
      sql`${t.status} <> 'ACTIVE' OR ${t.profileType} = 'INTERNAL' OR ${t.kycVerified}`,
    ),
  ],
);

/**
 * Account product: one account a profile holds. A profile has many (e.g. an agent: an AGENT_FLOAT and
 * a COMMISSION account); each has one stock per currency. product_type decides what the account is for
 * and who may hold it.
 */
export const accountProduct = pgTable(
  'account_product',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id').notNull(),
    // copy of the owner's type, enforced by FK
    profileType: profileType('profile_type').notNull(),
    productType: productType('product_type').notNull(),
    // label, e.g. 'Fee income' or 'Tax payable' for INTERNAL accounts
    name: varchar('name', { length: 140 }),
    // FROZEN / CLOSED applies to all its stocks
    status: accountStatus('status').notNull().default('ACTIVE'),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'fk_account_owner',
      columns: [t.profileId, t.profileType],
      foreignColumns: [profile.id, profile.profileType],
    }),
    check(
      'chk_account_owner',
      sql`(${t.productType} = 'CURRENT' AND ${t.profileType} = 'INDIVIDUAL')
       OR (${t.productType} IN ('AGENT_FLOAT', 'COMMISSION') AND ${t.profileType} = 'AGENT')
       OR (${t.productType} = 'INTERNAL' AND ${t.profileType} = 'INTERNAL')`,
    ),
    index('idx_account_product_profile').on(t.profileId),
  ],
);

/**
 * Stock: one currency balance inside an account product. The payment engine moves money between stocks.
 *   ledger_balance    = posted balance, kept in step with the stock's Formance account
 *   hold_amount       = funds reserved by payment orders still in progress
 *   available_balance = ledger_balance - hold_amount (what the owner can spend), computed by the DB
 */
export const stock = pgTable(
  'stock',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountProductId: uuid('account_product_id')
      .notNull()
      .references(() => accountProduct.id),
    // account number shown to the owner
    stockNumber: varchar('stock_number', { length: 34 })
      .notNull()
      .unique()
      .default(sql`lpad(nextval('stock_number_seq')::text, 12, '0')`),
    // ISO 4217, e.g. USD, KHR
    currency: char('currency', { length: 3 }).notNull(),
    // Formance account address
    ledgerAccount: varchar('ledger_account', { length: 200 }).notNull().unique(),
    ledgerBalance: numeric('ledger_balance', { precision: 20, scale: 2 }).notNull().default('0'),
    holdAmount: numeric('hold_amount', { precision: 20, scale: 2 }).notNull().default('0'),
    availableBalance: numeric('available_balance', { precision: 20, scale: 2 }).generatedAlwaysAs(
      sql`ledger_balance - hold_amount`,
    ),
    status: accountStatus('status').notNull().default('ACTIVE'),
    ...timestamps,
    // optimistic locking on balance updates
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('uq_stock_currency').on(t.accountProductId, t.currency), // one stock per currency per account
    check('chk_stock_hold', sql`${t.holdAmount} >= 0`),
  ],
);

export type Profile = typeof profile.$inferSelect;
export type AccountProduct = typeof accountProduct.$inferSelect;
export type Stock = typeof stock.$inferSelect;
