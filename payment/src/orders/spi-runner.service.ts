import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApplicationFailure } from '@temporalio/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/database.module.js';
import { paymentOrders, service, serviceCommand, spi, spiExternalConfig, spiInternalConfig } from '../db/schema.js';
import { SPI_REJECTED, type SpiCall } from '../temporal/types.js';

type OrderSummary = {
  orderId: string;
  orderReference: string;
  serviceCode: string;
  commandType: string;
  status: string;
  amount: string;
  currency: string;
  externalReference: string | null;
  payerName: string;
  payeeName: string | null;
};

type InternalHandler = (order: OrderSummary, operation: string) => Promise<string>;

const rejected = (message: string) => ApplicationFailure.nonRetryable(message, SPI_REJECTED);

/**
 * Calls the SPIs configured on a command. A provider's refusal (4xx, or an internal handler saying
 * no) throws a non-retryable SpiRejected; outages throw ordinary errors, which Temporal retries up to
 * the SPI's max_retries.
 */
@Injectable()
export class SpiRunnerService {
  private readonly logger = new Logger('SPI');

  /** Handlers for INTERNAL SPIs, by handler_name. */
  private readonly handlers: Record<string, InternalHandler> = {
    // Demo screening: names containing BLOCKED are refused.
    'sanctions-screening': async (order) => {
      if ([order.payerName, order.payeeName].some((n) => /BLOCKED/i.test(n ?? ''))) throw rejected('party is on the sanctions list');
      return 'clear';
    },
    // Demo notification: written to the log.
    'push-notification': async (order) => {
      this.logger.log(`push → ${order.payerName}: ${order.orderReference} ${order.serviceCode} ${order.amount} ${order.currency} ${order.status}`);
      return 'sent';
    },
    noop: async () => 'ok',
  };

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async call(orderId: string, call: SpiCall): Promise<{ detail: string }> {
    const order = await this.summary(orderId);
    const [row] = await this.db
      .select({ spi, internal: spiInternalConfig, external: spiExternalConfig })
      .from(spi)
      .leftJoin(spiInternalConfig, eq(spiInternalConfig.spiId, spi.id))
      .leftJoin(spiExternalConfig, eq(spiExternalConfig.spiId, spi.id))
      .where(eq(spi.code, call.spiCode));
    if (!row) throw rejected(`SPI ${call.spiCode} not found`);

    if (row.internal) {
      const handler = this.handlers[row.internal.handlerName];
      if (!handler) throw rejected(`no internal handler named ${row.internal.handlerName}`);
      return { detail: await handler(order, call.operation) };
    }
    if (!row.external) throw rejected(`SPI ${call.spiCode} has no configuration`);
    return this.callExternal(row.external, call, order);
  }

  private async callExternal(cfg: typeof spiExternalConfig.$inferSelect, call: SpiCall, order: OrderSummary) {
    if (cfg.protocol !== 'REST') throw rejected(`${cfg.protocol} SPIs are not supported yet`);
    const [method, path] = call.operation.split(/\s+/, 2);
    if (!method || !path?.startsWith('/')) throw rejected(`operation must look like "POST /path": ${call.operation}`);

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    // credential_ref names the secret (an environment variable here, a vault key in production).
    const secret = cfg.credentialRef ? process.env[cfg.credentialRef] : undefined;
    if (cfg.authType === 'API_KEY') headers['x-api-key'] = secret ?? '';
    else if (cfg.authType === 'BASIC') headers.authorization = `Basic ${Buffer.from(secret ?? '').toString('base64')}`;
    else if (cfg.authType !== 'NONE') throw rejected(`${cfg.authType} auth is not supported yet`);

    const res = await fetch(cfg.baseUrl.replace(/\/$/, '') + path, {
      method: method.toUpperCase(),
      headers,
      body: method.toUpperCase() === 'GET' ? undefined : JSON.stringify({ reference: order.orderId, ...order }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as { partnerRef?: string; reason?: string; status?: string };
    if (res.ok) return { detail: body.partnerRef ?? body.status ?? String(res.status) };
    if (res.status >= 400 && res.status < 500) throw rejected(body.reason ?? `${call.spiCode} answered ${res.status}`);
    throw new Error(`${call.spiCode} answered ${res.status}`);
  }

  private async summary(orderId: string): Promise<OrderSummary> {
    const [o] = await this.db
      .select({
        orderId: paymentOrders.id,
        orderReference: paymentOrders.orderReference,
        serviceCode: service.code,
        commandType: serviceCommand.commandType,
        status: paymentOrders.status,
        amount: paymentOrders.amount,
        currency: paymentOrders.currency,
        externalReference: paymentOrders.externalReference,
        payerName: paymentOrders.payerName,
        payeeName: paymentOrders.payeeName,
      })
      .from(paymentOrders)
      .innerJoin(service, eq(service.id, paymentOrders.serviceId))
      .innerJoin(serviceCommand, eq(serviceCommand.id, paymentOrders.serviceCommandId))
      .where(eq(paymentOrders.id, orderId));
    return o;
  }
}
