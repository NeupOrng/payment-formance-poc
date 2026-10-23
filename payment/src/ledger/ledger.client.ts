import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import http from 'node:http';
import https from 'node:https';
import type { LedgerRequest } from '../db/schema.js';

export class LedgerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }

  /** 400s are business rejections (e.g. INSUFFICIENT_FUND); retrying will not help. */
  get isRejection() {
    return this.status === 400;
  }
}

export type LedgerTransaction = {
  id: number;
  timestamp: string;
  reference?: string;
  reverted: boolean;
  metadata: Record<string, string>;
  postings: {
    source: string;
    destination: string;
    asset: string;
    amount: number | string;
  }[];
};

type Volumes = Record<string, { input: number; output: number; balance: number }>;

/** Thin client for the Formance Ledger v2 HTTP API. */
@Injectable()
export class LedgerClient implements OnModuleInit {
  private readonly logger = new Logger(LedgerClient.name);
  private readonly baseUrl: string;
  readonly ledger: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.getOrThrow<string>('LEDGER_URL').replace(/\/$/, '');
    this.ledger = config.get<string>('LEDGER_NAME') ?? 'mobilebank';
  }

  async onModuleInit() {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.request('POST', `/v2/${this.ledger}`, {});
        this.logger.log(`Created ledger "${this.ledger}"`);
        return;
      } catch (err) {
        if (err instanceof LedgerError && err.code === 'LEDGER_ALREADY_EXISTS') return;
        if (attempt >= 10) throw err;
        this.logger.warn(`Ledger not reachable yet (${(err as Error).message}), retrying`);
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }
  }

  /** Same Idempotency-Key + same body returns the original transaction instead of posting twice. */
  async createTransaction(body: LedgerRequest, idempotencyKey: string): Promise<{ id: number }> {
    const res = await this.request<{ data: { id: number } }>(
      'POST',
      `/v2/${this.ledger}/transactions`,
      body,
      { 'Idempotency-Key': idempotencyKey },
    );
    return { id: res.data.id };
  }

  async getTransaction(id: number): Promise<LedgerTransaction> {
    const res = await this.request<{ data: LedgerTransaction }>(
      'GET',
      `/v2/${this.ledger}/transactions/${id}`,
    );
    const { postings, metadata, timestamp, reference, reverted } = res.data;
    return {
      id,
      timestamp,
      reference,
      reverted,
      metadata,
      // Amounts as strings, like every other amount in this API.
      postings: postings.map((p) => ({ ...p, amount: String(p.amount) })),
    };
  }

  async findTransactionByReference(reference: string): Promise<{ id: number } | null> {
    // The v2 list endpoint takes its filter as a JSON body on GET, which fetch() does not allow.
    const res = await this.request<{ cursor: { data: { id: number }[] } }>(
      'GET',
      `/v2/${this.ledger}/transactions?pageSize=1`,
      { $match: { reference } },
    );
    const tx = res.cursor.data[0];
    return tx ? { id: tx.id } : null;
  }

  async getVolumes(address: string): Promise<Volumes> {
    try {
      const res = await this.request<{ data: { volumes?: Volumes } }>(
        'GET',
        `/v2/${this.ledger}/accounts/${encodeURIComponent(address)}?expand=volumes`,
      );
      return res.data.volumes ?? {};
    } catch (err) {
      // Formance creates an account on its first posting; before that it simply has no volumes.
      if (err instanceof LedgerError && err.status === 404) return {};
      throw err;
    }
  }

  private request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const transport = url.protocol === 'https:' ? https : http;

    return new Promise<T>((resolve, reject) => {
      const req = transport.request(
        url,
        {
          method,
          timeout: 10_000,
          headers: {
            accept: 'application/json',
            ...(payload && {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(payload),
            }),
            ...headers,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            const status = res.statusCode ?? 0;
            const json = text ? JSON.parse(text) : {};
            if (status >= 200 && status < 300) return resolve(json as T);
            reject(
              new LedgerError(
                status,
                json.errorCode ?? `HTTP_${status}`,
                json.errorMessage ?? text,
              ),
            );
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
