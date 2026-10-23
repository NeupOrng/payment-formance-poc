import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const CURRENCIES = ['USD', 'KHR'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const KYC_STATUSES = ['pending', 'verified', 'rejected'] as const;
export const CUSTOMER_STATUSES = ['active', 'suspended', 'closed'] as const;
export const ACCOUNT_STATUSES = ['active', 'frozen', 'closed'] as const;

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fullName: text('full_name').notNull(),
    phoneNumber: text('phone_number').notNull().unique(),
    kycStatus: text('kyc_status', { enum: KYC_STATUSES })
      .notNull()
      .default('pending'),
    status: text('status', { enum: CUSTOMER_STATUSES })
      .notNull()
      .default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      'customers_kyc_status_check',
      sql`${t.kycStatus} in ('pending', 'verified', 'rejected')`,
    ),
    check(
      'customers_status_check',
      sql`${t.status} in ('active', 'suspended', 'closed')`,
    ),
  ],
);

// Exactly two accounts per customer: one USD, one KHR. Balances live in Formance, not here.
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    currency: text('currency', { enum: CURRENCIES }).notNull(),
    asset: text('asset').notNull(),
    ledgerAddress: text('ledger_address').notNull().unique(),
    status: text('status', { enum: ACCOUNT_STATUSES })
      .notNull()
      .default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('accounts_customer_currency_unique').on(t.customerId, t.currency),
    index('accounts_customer_id_idx').on(t.customerId),
    check('accounts_currency_check', sql`${t.currency} in ('USD', 'KHR')`),
    check(
      'accounts_status_check',
      sql`${t.status} in ('active', 'frozen', 'closed')`,
    ),
  ],
);

export type Customer = typeof customers.$inferSelect;
export type Account = typeof accounts.$inferSelect;
