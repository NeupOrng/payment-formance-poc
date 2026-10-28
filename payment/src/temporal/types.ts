// Types shared by the workflow (deterministic sandbox: type-only imports!) and the activities.
// Workflow arguments and results travel as JSON, so amounts stay decimal strings here.
import type { CommandType, LedgerStep, PaymentStatus } from '../db/schema.js';

export const TASK_QUEUE = 'payments';

export type OrderInput = {
  orderId: string;
  workflowId: string;
  idempotencyKey: string;
  customerId: string;
  serviceCode: string;
  commandType: CommandType;
  amount?: string;
  payerStockId?: string;
  payeeStockId?: string;
  externalReference?: string;
  originalOrderId?: string;
};

/** One workflow per (payer profile, Idempotency-Key), mirroring uq_idempotency on payment_orders. */
export const workflowIdFor = (customerId: string, idempotencyKey: string) => `order-${customerId}-${idempotencyKey}`;

export type SpiCall = {
  stage: 'PRE_PAYMENT' | 'POST_PAYMENT' | 'NOTIFICATION';
  sequence: number;
  spiCode: string;
  spiType: 'INTERNAL' | 'EXTERNAL';
  operation: string;
  timeoutMs: number;
  maxRetries: number;
};

export type PreparedOrder = {
  orderId: string;
  status: PaymentStatus;
  requiresAuthorization: boolean;
  authorizationTimeoutSeconds: number;
  spis: SpiCall[];
};

export type StepResult = { ok: true; ledgerTxId: string | null } | { ok: false; reason: string };

/** Where the saga is; exposed as a query so the API knows when to answer. */
export type SagaState =
  | 'PREPARING'
  | 'RESERVING'
  | 'AWAITING_AUTHORIZATION'
  | 'PROCESSING'
  | 'COMPENSATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type OrderOutcome = { orderId: string; status: PaymentStatus };

/** Activity failure types the workflow and the API understand. */
export const VALIDATION_ERROR = 'ValidationError';
export const SPI_REJECTED = 'SpiRejected';

export interface SagaActivities {
  /** Validates, prices and records the order with its movements and planned ledger transactions (idempotent). */
  prepareOrder(input: OrderInput): Promise<PreparedOrder>;
  /** Posts one planned ledger transaction to Formance (idempotent: reference `{orderId}:{step}`). */
  postLedgerStep(orderId: string, step: LedgerStep): Promise<StepResult>;
  /** Calls one SPI; throws SpiRejected when the provider refuses. */
  callSpi(orderId: string, call: SpiCall): Promise<{ detail: string }>;
  /** Moves the order to a new status with a history row (idempotent; ignores moves out of a final status). */
  transition(orderId: string, to: PaymentStatus, reasonCode: string | null, changedBy: string): Promise<void>;
}
