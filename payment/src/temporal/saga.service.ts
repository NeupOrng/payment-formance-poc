import { ConflictException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, WorkflowExecutionAlreadyStartedError, WorkflowFailedError, type WorkflowHandle } from '@temporalio/client';
import { ApplicationFailure, WorkflowIdConflictPolicy, WorkflowIdReusePolicy } from '@temporalio/common';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DRIZZLE, type Database } from '../db/database.module.js';
import { service, type CommandType } from '../db/schema.js';
import type { CreatePaymentDto } from '../orders/dto.js';
import { OrdersService } from '../orders/orders.service.js';
import { ProfileClient } from '../profile/profile.client.js';
import { TEMPORAL_CLIENT } from './temporal.providers.js';
import { TASK_QUEUE, VALIDATION_ERROR, workflowIdFor, type OrderInput, type OrderOutcome, type SagaState } from './types.js';
import type { orderSaga } from './workflows.js';

export type SagaResponse = { statusCode: 201 | 202; body: unknown };
type Handle = WorkflowHandle<typeof orderSaga>;

const FINAL: SagaState[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

/**
 * Starts and steers order sagas. Each call waits up to SAGA_WAIT_MS for the saga to reach the
 * point the caller cares about — 201 with the order if it did, 202 with the order as it stands
 * (poll GET /payments/:id) if it is still busy, e.g. waiting for a slow provider.
 */
@Injectable()
export class SagaService {
  private readonly waitMs: number;

  constructor(
    @Inject(TEMPORAL_CLIENT) private readonly client: Client,
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly orders: OrdersService,
    private readonly profiles: ProfileClient,
    config: ConfigService,
  ) {
    this.waitMs = Number(config.get('SAGA_WAIT_MS') ?? 5_000);
  }

  /** A new PAYMENT order: answers once it awaits authorization (or ended early, e.g. insufficient funds). */
  async createPayment(dto: CreatePaymentDto, idempotencyKey: string) {
    const payer = await this.profiles.stock(dto.payerStockId);
    const customerId = payer.profile.id;
    return this.run(
      {
        ...this.ids(customerId, idempotencyKey),
        serviceCode: dto.serviceCode,
        commandType: 'PAYMENT',
        amount: dto.amount,
        payerStockId: dto.payerStockId,
        payeeStockId: dto.payeeStockId,
        externalReference: dto.externalReference,
      },
      ['AWAITING_AUTHORIZATION', ...FINAL],
    );
  }

  /** Customer authentication: the saga moves to PROCESSING and runs to the end. */
  async authorize(orderId: string, by?: string) {
    const { order, handle } = await this.pending(orderId);
    await handle.signal('authorize', { by: by ?? `customer:${order.customerId}` });
    return this.waitFor(handle, orderId, FINAL);
  }

  /** Before authorization: cancels the order (hold released). After completion: a CANCEL order. */
  async cancel(orderId: string, idempotencyKey: string) {
    const order = await this.orders.find(orderId);
    if (!order) throw new NotFoundException('payment order not found');
    if (order.status === 'PENDING') {
      const { handle } = await this.pending(orderId);
      await handle.signal('cancel', { by: `customer:${order.customerId}` });
      return this.waitFor(handle, orderId, FINAL);
    }
    if (order.status !== 'COMPLETED') throw new ConflictException(`a ${order.status} order cannot be cancelled`);
    return this.reverse(order, 'CANCEL', undefined, idempotencyKey);
  }

  async refund(orderId: string, amount: string | undefined, idempotencyKey: string) {
    const order = await this.orders.find(orderId);
    if (!order) throw new NotFoundException('payment order not found');
    return this.reverse(order, 'REFUND', amount, idempotencyKey);
  }

  private async reverse(order: { id: string; customerId: string; serviceId: string }, type: CommandType, amount: string | undefined, key: string) {
    const [svc] = await this.db.select({ code: service.code }).from(service).where(eq(service.id, order.serviceId));
    return this.run(
      { ...this.ids(order.customerId, key), serviceCode: svc.code, commandType: type, amount, originalOrderId: order.id },
      FINAL,
    );
  }

  private ids(customerId: string, idempotencyKey: string) {
    return { orderId: randomUUID(), workflowId: workflowIdFor(customerId, idempotencyKey), idempotencyKey, customerId };
  }

  private async run(input: OrderInput, until: SagaState[]) {
    return this.waitFor(await this.start(input), input.orderId, until);
  }

  /** A repeated Idempotency-Key reuses the existing saga (running or finished) instead of starting another. */
  private async start(input: OrderInput): Promise<Handle> {
    try {
      return await this.client.workflow.start<typeof orderSaga>('orderSaga', {
        taskQueue: TASK_QUEUE,
        workflowId: input.workflowId,
        args: [input],
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      });
    } catch (err) {
      if (err instanceof WorkflowExecutionAlreadyStartedError) return this.client.workflow.getHandle<typeof orderSaga>(input.workflowId);
      throw err;
    }
  }

  private async pending(orderId: string) {
    const order = await this.orders.find(orderId);
    if (!order) throw new NotFoundException('payment order not found');
    const handle = this.client.workflow.getHandle<typeof orderSaga>(workflowIdFor(order.customerId, order.idempotencyKey));
    const state = await handle.query<SagaState>('state').catch(() => null);
    if (order.status !== 'PENDING' || state !== 'AWAITING_AUTHORIZATION') {
      throw new ConflictException(`order is ${order.status}, not awaiting authorization`);
    }
    return { order, handle };
  }

  private async waitFor(handle: Handle, fallbackId: string, until: SagaState[]): Promise<{ statusCode: 201 | 202; body: unknown }> {
    let outcome: OrderOutcome | undefined;
    let failure: unknown;
    let settled = false;
    handle.result().then(
      (o) => ((outcome = o), (settled = true)),
      (e) => ((failure = e), (settled = true)),
    );

    let reached = false;
    const deadline = Date.now() + this.waitMs;
    while (!settled && Date.now() < deadline) {
      const state = await handle.query<SagaState>('state').catch(() => null);
      if (state && until.includes(state)) {
        reached = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    if (failure) throw this.toHttp(failure);

    const orderId = outcome?.orderId ?? (await handle.query<string>('orderId').catch(() => fallbackId));
    const exists = await this.orders.find(orderId);
    return {
      statusCode: settled || reached ? 201 : 202,
      body: exists ? await this.orders.get(orderId) : { id: orderId, status: 'PENDING', workflowId: handle.workflowId },
    };
  }

  /** Validation failures from prepareOrder become the same 4xx a synchronous API would return. */
  private toHttp(err: unknown) {
    let cause: unknown = err instanceof WorkflowFailedError ? err.cause : undefined;
    while (cause) {
      if (cause instanceof ApplicationFailure && cause.type === VALIDATION_ERROR) {
        const [details] = cause.details as [{ status: number; response: string | object }];
        return new HttpException(details.response, details.status);
      }
      cause = (cause as { cause?: unknown }).cause;
    }
    return err;
  }
}
