// Shapes returned by the Profile Service and the Payment Engine.
// Amounts are decimal strings in the order / stock currency, e.g. "21.00".

export type Currency = 'USD' | 'KHR'
export type ProfileType = 'INDIVIDUAL' | 'AGENT' | 'INTERNAL'
export type ProfileStatus = 'PENDING_KYC' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED'
export type ProductType = 'CURRENT' | 'AGENT_FLOAT' | 'COMMISSION' | 'INTERNAL'
export type AccountStatus = 'ACTIVE' | 'FROZEN' | 'CLOSED'
export type PaymentStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'REVERSED'
export type MovementStatus = 'PENDING' | 'POSTED' | 'FAILED' | 'REVERSED'
export type CommandType = 'PAYMENT' | 'REFUND' | 'CANCEL'
export type LedgerStep = 'RESERVE' | 'SETTLE' | 'REVERT' | 'RELEASE'
export type ConfigStatus = 'ACTIVE' | 'INACTIVE'

export interface Profile {
  id: string
  profileNumber: string
  profileType: ProfileType
  fullName: string
  phoneNumber: string | null
  kycVerified: boolean
  status: ProfileStatus
  createdAt: string
}

export interface Stock {
  id: string
  accountProductId: string
  stockNumber: string
  currency: Currency
  ledgerAccount: string
  /** Mirrored from Formance by the Profile Service. */
  ledgerBalance: string
  holdAmount: string
  availableBalance: string
  status: AccountStatus
  updatedAt: string
}

export interface AccountProduct {
  id: string
  productType: ProductType
  name: string | null
  status: AccountStatus
  stocks: Stock[]
}

export interface ProfileWithAccounts extends Profile {
  accounts: AccountProduct[]
}

/** A stock with its account and owner (GET /stocks). */
export interface StockView {
  id: string
  stockNumber: string
  currency: Currency
  ledgerAccount: string
  status: AccountStatus
  account: { id: string, productType: ProductType, name: string | null, status: AccountStatus }
  profile: { id: string, profileNumber: string, profileType: ProfileType, fullName: string, status: ProfileStatus }
}

export interface PaymentOrder {
  id: string
  orderReference: string
  externalReference: string | null
  serviceId: string
  serviceCode: string
  serviceName: string
  commandType: CommandType
  originalOrderId: string | null
  status: PaymentStatus
  statusReasonCode: string | null
  customerId: string
  payerAccountId: string
  payerName: string
  payeeAccountId: string
  payeeName: string | null
  amount: string
  currency: Currency
  createdAt: string
  /** Only when listing by stock: + received, − paid by that stock. */
  netForStock?: string | null
}

export interface OrderMovement {
  movementSequence: number
  amountType: string
  amount: string
  fromStockId: string
  toStockId: string
  status: MovementStatus
  coreReference: string | null
}

export interface StatusChange {
  id: number
  fromStatus: PaymentStatus | null
  toStatus: PaymentStatus
  reasonCode: string | null
  changedBy: string
  changedAt: string
}

export interface PaymentOrderDetail extends PaymentOrder {
  tierConfigId: string | null
  workflowId: string
  amounts: { amountType: string, amount: string }[]
  movements: OrderMovement[]
  ledgerTransactions: { step: LedgerStep, status: 'PLANNED' | 'POSTED' | 'REJECTED', ledgerTxId: string | null, failureReason: string | null }[]
  history: StatusChange[]
}

export interface LedgerPosting {
  source: string
  destination: string
  amount: string
  fromStockId: string | null
  toStockId: string | null
  amountType: string | null
  movementSequence: number | null
}

export interface LedgerTx {
  step: LedgerStep
  status: 'PLANNED' | 'POSTED' | 'REJECTED'
  ledgerTxId: string | null
  timestamp: string | null
  failureReason: string | null
  postings: LedgerPosting[]
}

export interface ServiceSummary {
  id: string
  code: string
  name: string
  currency: Currency
  status: ConfigStatus
  group: { id: string, name: string, status: ConfigStatus }
}

export interface TierRule {
  id: string
  amountType: string
  calcSequence: number
  calcMethod: 'FIXED' | 'FORMULA'
  baseAmountType: string | null
  fixedValue: string | null
  percentage: string | null
  formulaExpression: string | null
  minValue: string | null
  maxValue: string | null
}

export interface TierMovement {
  id: string
  movementSequence: number
  amountType: string
  fromStockRole: 'PAYER' | 'PAYEE' | 'SPECIFIC'
  fromStockId: string | null
  toStockRole: 'PAYER' | 'PAYEE' | 'SPECIFIC'
  toStockId: string | null
}

export interface ServiceConfig extends ServiceSummary {
  commands: {
    id: string
    commandType: CommandType
    status: ConfigStatus
    spis: { id: string, triggerStage: 'PRE_PAYMENT' | 'POST_PAYMENT' | 'NOTIFICATION', executionSequence: number, spiOperation: string, status: ConfigStatus, spi: { code: string, name: string, spiType: 'INTERNAL' | 'EXTERNAL' } }[]
    tiers: { id: string, minAmount: string | null, maxAmount: string | null, status: ConfigStatus, rules: TierRule[], movements: TierMovement[] }[]
  }[]
}
