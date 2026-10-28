// Temporal workflows. This file runs in Temporal's deterministic sandbox: no I/O, no Node APIs,
// only `@temporalio/workflow` and type-only imports. Every side effect is an activity.
import {
  ActivityFailure,
  ApplicationFailure,
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';
import {
  SPI_REJECTED,
  VALIDATION_ERROR,
  type OrderInput,
  type OrderOutcome,
  type SagaActivities,
  type SagaState,
  type SpiCall,
  type StepResult,
} from './types.js';

// Validation errors are final; anything else (DB or Profile Service down) is retried a few times.
const prepare = proxyActivities<SagaActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 5, nonRetryableErrorTypes: [VALIDATION_ERROR] },
});

// Ledger and status steps retry until they succeed: they are idempotent, and a half-finished saga
// (e.g. a hold never released) is worse than a slow one.
const ledger = proxyActivities<SagaActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '30 seconds' },
});

/** Each SPI call gets the timeout and retries configured for its provider. */
const spiActivities = (call: SpiCall) =>
  proxyActivities<SagaActivities>({
    startToCloseTimeout: call.timeoutMs + 1_000,
    retry: { initialInterval: '1 second', maximumAttempts: call.maxRetries + 1, nonRetryableErrorTypes: [SPI_REJECTED] },
  });

export const authorizeSignal = defineSignal<[{ by: string }]>('authorize');
export const cancelSignal = defineSignal<[{ by: string }]>('cancel');
export const orderIdQuery = defineQuery<string>('orderId');
export const stateQuery = defineQuery<SagaState>('state');

/**
 * The saga behind every payment order (PAYMENT, REFUND, CANCEL):
 *
 *   prepare → reserve → [await authorization] → PROCESSING → PRE_PAYMENT SPIs → settle
 *           → POST_PAYMENT SPIs → COMPLETED → NOTIFICATION SPIs (best effort)
 *
 * Reason codes fit payment_orders.status_reason_code (VARCHAR(20)).
 * Compensation: insufficient funds → FAILED · no authorization in time → release, CANCELLED ·
 * cancelled while waiting → release, CANCELLED · PRE_PAYMENT fails → release, FAILED ·
 * POST_PAYMENT fails → revert settle, release, FAILED.
 */
export async function orderSaga(input: OrderInput): Promise<OrderOutcome> {
  let orderId = input.orderId;
  let state: SagaState = 'PREPARING';
  let authorizedBy: string | null = null;
  let cancelledBy: string | null = null;
  setHandler(orderIdQuery, () => orderId);
  setHandler(stateQuery, () => state);
  setHandler(authorizeSignal, ({ by }) => void (state === 'AWAITING_AUTHORIZATION' && (authorizedBy ??= by)));
  setHandler(cancelSignal, ({ by }) => void (state === 'AWAITING_AUTHORIZATION' && (cancelledBy ??= by)));

  const prepared = await prepare.prepareOrder(input);
  orderId = prepared.orderId;
  if (prepared.status !== 'PENDING') {
    state = prepared.status === 'COMPLETED' ? 'COMPLETED' : prepared.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
    return { orderId, status: prepared.status };
  }

  const end = async (status: 'FAILED' | 'CANCELLED', reason: string): Promise<OrderOutcome> => {
    await ledger.transition(orderId, status, reason, 'SYSTEM');
    state = status;
    return { orderId, status };
  };
  const release = async () => {
    state = 'COMPENSATING';
    expectOk(await ledger.postLedgerStep(orderId, 'RELEASE'), 'RELEASE');
  };

  // 1. Reserve: the money can't be spent twice while the order waits.
  state = 'RESERVING';
  const reserved = await ledger.postLedgerStep(orderId, 'RESERVE');
  if (!reserved.ok) return end('FAILED', reasonCode(reserved.reason));

  // 2. Customer authentication (PIN / OTP in a real app), or cancellation, within the time limit.
  let processedBy = 'SYSTEM';
  if (prepared.requiresAuthorization) {
    state = 'AWAITING_AUTHORIZATION';
    const answered = await condition(() => authorizedBy !== null || cancelledBy !== null, prepared.authorizationTimeoutSeconds * 1_000);
    if (!answered) return release().then(() => end('CANCELLED', 'AUTH_TIMEOUT'));
    if (cancelledBy) return release().then(() => end('CANCELLED', 'CANCELLED_BY_USER'));
    processedBy = authorizedBy!;
  }
  state = 'PROCESSING';
  await ledger.transition(orderId, 'PROCESSING', null, processedBy);

  const stage = (name: SpiCall['stage']) => prepared.spis.filter((s) => s.stage === name);
  const call = (c: SpiCall) => spiActivities(c).callSpi(orderId, c);

  // 3. PRE_PAYMENT: e.g. validate the biller account; a failure fails the order.
  for (const c of stage('PRE_PAYMENT')) {
    try {
      await call(c);
    } catch (err) {
      await release();
      return end('FAILED', isRejected(err) ? 'PRE_PAY_REJECTED' : 'PRE_PAY_FAILED');
    }
  }

  // 4. Settle the balance movements from the holds.
  const settled = await ledger.postLedgerStep(orderId, 'SETTLE');
  if (!settled.ok) {
    await release();
    return end('FAILED', reasonCode(settled.reason));
  }

  // 5. POST_PAYMENT: e.g. confirm to the biller; a failure reverts the movements.
  for (const c of stage('POST_PAYMENT')) {
    try {
      await call(c);
    } catch (err) {
      state = 'COMPENSATING';
      expectOk(await ledger.postLedgerStep(orderId, 'REVERT'), 'REVERT');
      await release();
      return end('FAILED', isRejected(err) ? 'POST_PAY_REJECTED' : 'POST_PAY_FAILED');
    }
  }

  await ledger.transition(orderId, 'COMPLETED', null, 'SYSTEM');
  state = 'COMPLETED';

  // 6. NOTIFICATION: best effort, never changes the order.
  for (const c of stage('NOTIFICATION')) {
    try {
      await call(c);
    } catch {
      // ignored by design
    }
  }
  return { orderId, status: 'COMPLETED' };
}

/** A compensation that the ledger refuses needs a person: fail loudly so it shows in Temporal. */
function expectOk(result: StepResult, step: string) {
  if (!result.ok) throw ApplicationFailure.nonRetryable(`${step} rejected by the ledger: ${result.reason}`, 'CompensationFailed');
}

function isRejected(err: unknown) {
  return err instanceof ActivityFailure && err.cause instanceof ApplicationFailure && err.cause.type === SPI_REJECTED;
}

function reasonCode(ledgerReason: string) {
  return ledgerReason === 'insufficient_fund' ? 'INSUFFICIENT_FUNDS' : ledgerReason.toUpperCase().slice(0, 20);
}
