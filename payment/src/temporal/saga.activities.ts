import { HttpException, Injectable } from '@nestjs/common';
import { ApplicationFailure } from '@temporalio/common';
import { OrderLedgerService } from '../orders/order-ledger.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { SpiRunnerService } from '../orders/spi-runner.service.js';
import { VALIDATION_ERROR, type SagaActivities } from './types.js';

/** The activity implementations registered on the Temporal worker. */
@Injectable()
export class SagaActivitiesService {
  constructor(
    private readonly orders: OrdersService,
    private readonly ledger: OrderLedgerService,
    private readonly spis: SpiRunnerService,
  ) {}

  activities(): SagaActivities {
    return {
      prepareOrder: async (input) => {
        try {
          return await this.orders.prepare(input);
        } catch (err) {
          // A 4xx is the caller's mistake: fail the saga without retrying and let the API return it.
          if (err instanceof HttpException && err.getStatus() < 500) {
            throw ApplicationFailure.nonRetryable(err.message, VALIDATION_ERROR, { status: err.getStatus(), response: err.getResponse() });
          }
          throw err;
        }
      },
      postLedgerStep: (orderId, step) => this.ledger.postLedgerStep(orderId, step),
      callSpi: (orderId, call) => this.spis.call(orderId, call),
      transition: (orderId, to, reasonCode, changedBy) => this.ledger.transition(orderId, to, reasonCode, changedBy),
    };
  }
}
