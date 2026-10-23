import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Currency } from '../db/schema.js';

export type CustomerAccount = {
  id: string;
  customerId: string;
  currency: Currency;
  asset: string;
  ledgerAddress: string;
  status: 'active' | 'frozen' | 'closed';
  customerStatus: 'active' | 'suspended' | 'closed';
  kycStatus: 'pending' | 'verified' | 'rejected';
};

/** HTTP client for the customer service, which owns customers and their USD/KHR accounts. */
@Injectable()
export class CustomerClient {
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.getOrThrow<string>('CUSTOMER_SERVICE_URL').replace(/\/$/, '');
  }

  async getAccount(customerId: string, currency: Currency): Promise<CustomerAccount> {
    return this.get(`/customers/${customerId}/accounts/${currency}`);
  }

  async listAccounts(customerId: string): Promise<CustomerAccount[]> {
    return this.get(`/customers/${customerId}/accounts`);
  }

  private async get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, { signal: AbortSignal.timeout(5_000) });
    } catch {
      throw new ServiceUnavailableException('customer service unavailable');
    }
    if (res.status === 404) throw new NotFoundException('customer or account not found');
    if (!res.ok) throw new ServiceUnavailableException(`customer service returned ${res.status}`);
    return (await res.json()) as T;
  }
}
