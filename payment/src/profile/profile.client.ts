import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type StockView = {
  id: string;
  stockNumber: string;
  currency: string;
  ledgerAccount: string;
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  account: { id: string; productType: 'CURRENT' | 'AGENT_FLOAT' | 'COMMISSION' | 'INTERNAL'; name: string | null; status: 'ACTIVE' | 'FROZEN' | 'CLOSED' };
  profile: {
    id: string;
    profileNumber: string;
    profileType: 'INDIVIDUAL' | 'AGENT' | 'INTERNAL';
    fullName: string;
    status: 'PENDING_KYC' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
    kycVerified: boolean;
  };
};

/** HTTP client for the Profile Service, which owns profiles, account products and stocks. */
@Injectable()
export class ProfileClient {
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.getOrThrow<string>('PROFILE_SERVICE_URL').replace(/\/$/, '');
  }

  async stock(id: string): Promise<StockView> {
    const [s] = await this.stocks([id]);
    if (!s) throw new NotFoundException(`stock ${id} not found`);
    return s;
  }

  async stocks(ids: string[]): Promise<StockView[]> {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/stocks?ids=${unique.join(',')}`, { signal: AbortSignal.timeout(5_000) });
    } catch {
      throw new ServiceUnavailableException('profile service unavailable');
    }
    if (!res.ok) throw new ServiceUnavailableException(`profile service returned ${res.status}`);
    return (await res.json()) as StockView[];
  }
}

/** A stock can pay only if it, its account and its owner are all ACTIVE. */
export function canPay(s: StockView) {
  return s.status === 'ACTIVE' && s.account.status === 'ACTIVE' && s.profile.status === 'ACTIVE';
}

/** A stock can receive unless it, its account or its owner is CLOSED. */
export function canReceive(s: StockView) {
  return s.status !== 'CLOSED' && s.account.status !== 'CLOSED' && s.profile.status !== 'CLOSED';
}
