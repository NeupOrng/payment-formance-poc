import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CatalogService } from '../catalog/catalog.service.js';
import { ASSETS } from '../common/money.js';
import { CustomerClient } from '../customers/customer.client.js';
import { CURRENCIES } from '../db/schema.js';
import { LedgerClient } from '../ledger/ledger.client.js';
import { accountAddress } from '../movement/movement.js';

/** Balances are always read from Formance; nothing here is cached. */
@ApiTags('balances')
@Controller()
export class BalancesController {
  constructor(
    private readonly ledger: LedgerClient,
    private readonly customers: CustomerClient,
    private readonly catalog: CatalogService,
  ) {}

  @Get('customers/:customerId/balances')
  async customerBalances(@Param('customerId', ParseUUIDPipe) customerId: string) {
    const accounts = await this.customers.listAccounts(customerId);
    return Promise.all(
      accounts.map(async (a) => ({
        accountId: a.id,
        currency: a.currency,
        ...(await this.balance(a.ledgerAddress, a.asset)),
      })),
    );
  }

  /** Every specific account the service's balance movements use (partner, fees, tax, …), per currency. */
  @Get('services/:code/balances')
  async serviceBalances(@Param('code') code: string) {
    const paths = await this.catalog.accountPaths(code);
    return Promise.all(
      paths.flatMap((path) =>
        CURRENCIES.map(async (currency) => ({
          account: path,
          currency,
          ...(await this.balance(accountAddress(path, code, currency), ASSETS[currency])),
        })),
      ),
    );
  }

  private async balance(ledgerAddress: string, asset: string) {
    const volumes = await this.ledger.getVolumes(ledgerAddress);
    // Amounts are returned as strings in the smallest unit, like every other amount in this API.
    return { ledgerAddress, asset, balance: String(volumes[asset]?.balance ?? 0) };
  }
}
