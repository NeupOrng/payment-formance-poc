import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asc, desc, eq, and } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/database.module.js';
import {
  accounts,
  CURRENCIES,
  customers,
  type Account,
  type Currency,
} from '../db/schema.js';
import type {
  CreateCustomerDto,
  UpdateAccountStatusDto,
  UpdateCustomerStatusDto,
  UpdateKycDto,
} from './dto.js';

const ASSETS: Record<Currency, string> = { USD: 'USD/2', KHR: 'KHR/2' };

export function ledgerAddress(customerId: string, currency: Currency) {
  return `users:${customerId}:${currency.toLowerCase()}`;
}

@Injectable()
export class CustomersService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Creates the customer and its USD + KHR accounts in one transaction. */
  async create(dto: CreateCustomerDto) {
    const existing = await this.db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.phoneNumber, dto.phoneNumber));
    if (existing.length) {
      throw new ConflictException('phone number already registered');
    }

    return this.db.transaction(async (tx) => {
      const [customer] = await tx
        .insert(customers)
        .values({ fullName: dto.fullName, phoneNumber: dto.phoneNumber })
        .returning();
      const created = await tx
        .insert(accounts)
        .values(
          CURRENCIES.map((currency) => ({
            customerId: customer.id,
            currency,
            asset: ASSETS[currency],
            ledgerAddress: ledgerAddress(customer.id, currency),
          })),
        )
        .returning();
      return { ...customer, accounts: created };
    });
  }

  async list(limit: number, offset: number) {
    return this.db
      .select()
      .from(customers)
      .orderBy(desc(customers.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async get(id: string) {
    const [customer] = await this.db
      .select()
      .from(customers)
      .where(eq(customers.id, id));
    if (!customer) throw new NotFoundException('customer not found');
    return { ...customer, accounts: await this.accountsOf(id) };
  }

  async accountsOf(customerId: string): Promise<Account[]> {
    return this.db
      .select()
      .from(accounts)
      .where(eq(accounts.customerId, customerId))
      .orderBy(asc(accounts.currency));
  }

  /** Used by the payment service: the account plus the owner's status. */
  async accountByCurrency(customerId: string, currency: Currency) {
    const [row] = await this.db
      .select({
        account: accounts,
        customerStatus: customers.status,
        kycStatus: customers.kycStatus,
      })
      .from(accounts)
      .innerJoin(customers, eq(customers.id, accounts.customerId))
      .where(
        and(eq(accounts.customerId, customerId), eq(accounts.currency, currency)),
      );
    if (!row) throw new NotFoundException('account not found');
    return {
      ...row.account,
      customerStatus: row.customerStatus,
      kycStatus: row.kycStatus,
    };
  }

  async getAccount(id: string) {
    const [account] = await this.db
      .select()
      .from(accounts)
      .where(eq(accounts.id, id));
    if (!account) throw new NotFoundException('account not found');
    return account;
  }

  async updateKyc(id: string, dto: UpdateKycDto) {
    return this.updateCustomer(id, { kycStatus: dto.kycStatus });
  }

  async updateStatus(id: string, dto: UpdateCustomerStatusDto) {
    return this.updateCustomer(id, { status: dto.status });
  }

  async updateAccountStatus(id: string, dto: UpdateAccountStatusDto) {
    const [account] = await this.db
      .update(accounts)
      .set({ status: dto.status, updatedAt: new Date() })
      .where(eq(accounts.id, id))
      .returning();
    if (!account) throw new NotFoundException('account not found');
    return account;
  }

  private async updateCustomer(
    id: string,
    values: Partial<typeof customers.$inferInsert>,
  ) {
    const [customer] = await this.db
      .update(customers)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(customers.id, id))
      .returning();
    if (!customer) throw new NotFoundException('customer not found');
    return customer;
  }
}
