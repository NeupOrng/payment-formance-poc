import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { pgError } from '../common/pg-errors.js';
import { DRIZZLE, type Database } from '../db/database.module.js';
import {
  accountProduct,
  CURRENCIES,
  profile,
  stock,
  type Currency,
  type ProductType,
  type Profile,
} from '../db/schema.js';
import type {
  CreateAccountDto,
  CreateProfileDto,
  ListProfilesQuery,
  UpdateAccountStatusDto,
  UpdateKycDto,
  UpdateProfileStatusDto,
} from './dto.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Accounts every new profile gets, by type. INTERNAL profiles open theirs explicitly. */
const DEFAULT_PRODUCTS: Record<Profile['profileType'], ProductType[]> = {
  INDIVIDUAL: ['CURRENT'],
  AGENT: ['AGENT_FLOAT', 'COMMISSION'],
  INTERNAL: [],
};

/**
 * Formance address of a stock: `{profile type}:{CIF}:{product type}:{stock number}`, lower case.
 * Only ids, no personal data.
 */
export const ledgerAccountFor = (p: Pick<Profile, 'profileType' | 'profileNumber'>, product: ProductType, stockNumber: string) =>
  `${p.profileType}:${p.profileNumber}:${product}:${stockNumber}`.toLowerCase();

@Injectable()
export class ProfilesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(dto: CreateProfileDto) {
    const internal = dto.profileType === 'INTERNAL';
    const kycVerified = dto.kycVerified ?? false;
    try {
      const id = await this.db.transaction(async (tx) => {
        const [p] = await tx
          .insert(profile)
          .values({
            profileType: dto.profileType,
            fullName: dto.fullName,
            phoneNumber: dto.phoneNumber ?? null,
            kycVerified,
            status: internal || kycVerified ? 'ACTIVE' : 'PENDING_KYC',
          })
          .returning();
        for (const product of DEFAULT_PRODUCTS[dto.profileType]) {
          await this.openAccount(tx, p, product, null, dto.currencies ?? [...CURRENCIES]);
        }
        return p.id;
      });
      return this.get(id);
    } catch (err) {
      if (pgError(err)?.code === '23505') throw new ConflictException('phone number already registered');
      throw err;
    }
  }

  list(query: ListProfilesQuery) {
    return this.db
      .select()
      .from(profile)
      .where(query.type ? eq(profile.profileType, query.type) : undefined)
      .orderBy(desc(profile.createdAt))
      .limit(query.limit)
      .offset(query.offset);
  }

  async get(id: string) {
    const [p] = await this.db.select().from(profile).where(eq(profile.id, id));
    if (!p) throw new NotFoundException('profile not found');
    const accounts = await this.db
      .select()
      .from(accountProduct)
      .where(eq(accountProduct.profileId, id))
      .orderBy(asc(accountProduct.createdAt));
    const stocks = accounts.length
      ? await this.db
          .select()
          .from(stock)
          .where(inArray(stock.accountProductId, accounts.map((a) => a.id)))
          .orderBy(desc(stock.currency))
      : [];
    return {
      ...p,
      accounts: accounts.map((a) => ({ ...a, stocks: stocks.filter((s) => s.accountProductId === a.id) })),
    };
  }

  async updateKyc(id: string, dto: UpdateKycDto) {
    return this.updateProfile(id, {
      kycVerified: dto.kycVerified,
      // Losing KYC takes an active customer back to PENDING_KYC.
      ...(!dto.kycVerified && { status: sql`case when ${profile.profileType} = 'INTERNAL' then ${profile.status} else 'PENDING_KYC' end` }),
    });
  }

  updateStatus(id: string, dto: UpdateProfileStatusDto) {
    return this.updateProfile(id, { status: dto.status });
  }

  async addAccount(profileId: string, dto: CreateAccountDto) {
    const [p] = await this.db.select().from(profile).where(eq(profile.id, profileId));
    if (!p) throw new NotFoundException('profile not found');
    if (dto.productType === 'INTERNAL' && !dto.name) {
      throw new BadRequestException('INTERNAL accounts need a name, e.g. "Fee income"');
    }
    try {
      await this.db.transaction((tx) => this.openAccount(tx, p, dto.productType, dto.name ?? null, dto.currencies));
    } catch (err) {
      if (pgError(err)?.code === '23514') {
        throw new UnprocessableEntityException(`${p.profileType} profiles cannot hold ${dto.productType} accounts`);
      }
      throw err;
    }
    return this.get(profileId);
  }

  async updateAccountStatus(id: string, dto: UpdateAccountStatusDto) {
    const [a] = await this.db
      .update(accountProduct)
      .set({ status: dto.status, updatedAt: new Date() })
      .where(eq(accountProduct.id, id))
      .returning();
    if (!a) throw new NotFoundException('account not found');
    return a;
  }

  async updateStockStatus(id: string, dto: UpdateAccountStatusDto) {
    const [s] = await this.db
      .update(stock)
      .set({ status: dto.status, updatedAt: new Date() })
      .where(eq(stock.id, id))
      .returning();
    if (!s) throw new NotFoundException('stock not found');
    return s;
  }

  /** A stock with its account and owner: what the payment engine needs to validate and post. */
  async getStock(id: string) {
    const [row] = await this.stockViews([id]);
    if (!row) throw new NotFoundException('stock not found');
    return row;
  }

  stockViews(ids: string[]) {
    if (!ids.length) return Promise.resolve([]);
    return this.db
      .select({
        id: stock.id,
        stockNumber: stock.stockNumber,
        currency: stock.currency,
        ledgerAccount: stock.ledgerAccount,
        ledgerBalance: stock.ledgerBalance,
        holdAmount: stock.holdAmount,
        availableBalance: stock.availableBalance,
        status: stock.status,
        account: {
          id: accountProduct.id,
          productType: accountProduct.productType,
          name: accountProduct.name,
          status: accountProduct.status,
        },
        profile: {
          id: profile.id,
          profileNumber: profile.profileNumber,
          profileType: profile.profileType,
          fullName: profile.fullName,
          status: profile.status,
          kycVerified: profile.kycVerified,
        },
      })
      .from(stock)
      .innerJoin(accountProduct, eq(accountProduct.id, stock.accountProductId))
      .innerJoin(profile, eq(profile.id, accountProduct.profileId))
      .where(inArray(stock.id, ids));
  }

  private async openAccount(tx: Tx, p: Profile, product: ProductType, name: string | null, currencies: Currency[]) {
    const [account] = await tx
      .insert(accountProduct)
      .values({ profileId: p.id, profileType: p.profileType, productType: product, name })
      .returning();
    for (const currency of currencies) {
      const { rows } = await tx.execute<{ n: string }>(sql`select lpad(nextval('stock_number_seq')::text, 12, '0') as n`);
      const stockNumber = rows[0].n;
      await tx.insert(stock).values({
        accountProductId: account.id,
        stockNumber,
        currency,
        ledgerAccount: ledgerAccountFor(p, product, stockNumber),
      });
    }
    return account;
  }

  private async updateProfile(id: string, values: Record<string, unknown>) {
    try {
      const [p] = await this.db
        .update(profile)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(profile.id, id))
        .returning();
      if (!p) throw new NotFoundException('profile not found');
      return p;
    } catch (err) {
      if (pgError(err)?.code === '23514') {
        throw new UnprocessableEntityException('a profile can only be ACTIVE once KYC is verified');
      }
      throw err;
    }
  }
}
