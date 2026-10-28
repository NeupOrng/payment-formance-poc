import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import http from 'node:http';

type Volumes = Record<string, { input: number; output: number; balance: number }>;

/**
 * Read-only access to Formance, used only to mirror balances into the stock table.
 * Only the payment engine writes to the ledger.
 */
@Injectable()
export class LedgerReader {
  private readonly baseUrl: string;
  private readonly ledger: string;

  constructor(config: ConfigService) {
    this.baseUrl = (config.get<string>('LEDGER_URL') ?? 'http://localhost:3068').replace(/\/$/, '');
    this.ledger = config.get<string>('LEDGER_NAME') ?? 'mobilebank';
  }

  /** Balance of one account in one asset (0 if the account has never been used). */
  async balance(address: string, asset: string): Promise<bigint> {
    const res = await this.request<{ data: { volumes?: Volumes } }>(
      'GET',
      `/v2/${this.ledger}/accounts/${encodeURIComponent(address)}?expand=volumes`,
    );
    if (!res) return 0n;
    return BigInt(res.data.volumes?.[asset]?.balance ?? 0);
  }

  /** Sum of balances of every account under a prefix, e.g. all holds of one stock (`holds:{stockNumber}:`). */
  async balanceUnder(prefix: string, asset: string): Promise<bigint> {
    const res = await this.request<{ data: Record<string, number> }>(
      'GET',
      `/v2/${this.ledger}/aggregate/balances`,
      { $match: { address: prefix } },
    );
    return BigInt(res?.data?.[asset] ?? 0);
  }

  // GET with a JSON body (Formance v2 filters), which fetch() does not allow.
  private request<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    const url = new URL(this.baseUrl + path);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = http.request(
        url,
        {
          method,
          timeout: 10_000,
          headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {},
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode === 404) return resolve(null);
            if ((res.statusCode ?? 500) >= 300) return reject(new Error(`ledger ${res.statusCode}: ${text}`));
            resolve(text ? (JSON.parse(text) as T) : null);
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('ledger request timed out')));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
}
