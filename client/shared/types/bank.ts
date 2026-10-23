// Shapes returned by the customer and payment services. Amounts are strings of digits in the
// smallest unit (USD/2 and KHR/2 both have 2 decimals).

export type Currency = 'USD' | 'KHR'
export type TransferType = 'payment' | 'refund' | 'cancel' | 'topup'
export type TransferStatus = 'pending' | 'posted' | 'failed' | 'reversed'

export interface Account {
  id: string
  customerId: string
  currency: Currency
  asset: string
  ledgerAddress: string
  status: 'active' | 'frozen' | 'closed'
  createdAt: string
}

export interface Customer {
  id: string
  fullName: string
  phoneNumber: string
  kycStatus: 'pending' | 'verified' | 'rejected'
  status: 'active' | 'suspended' | 'closed'
  createdAt: string
  updatedAt: string
}

export interface CustomerWithAccounts extends Customer {
  accounts: Account[]
}

export interface Balance {
  accountId: string
  currency: Currency
  ledgerAddress: string
  asset: string
  balance: string
}

export interface Transfer {
  id: string
  type: TransferType
  status: TransferStatus
  serviceId: string | null
  originalTransferId: string | null
  /** Payer and payee customers; a top-up has no source, a bill payment no destination. */
  sourceCustomerId: string | null
  sourceAccountId: string | null
  destinationCustomerId: string | null
  destinationAccountId: string | null
  /** Net effect of the postings on each customer's account (+ in, − out). */
  sourceNet: string | null
  destinationNet: string | null
  currency: Currency
  asset: string
  amount: string
  ledgerTxId: string | null
  externalRef: string | null
  failureReason: string | null
  createdAt: string
  updatedAt: string
}

export interface TransferAmount {
  amountType: AmountType
  amount: string
  pricingTierId: string | null
}

export interface TransferEvent {
  id: number
  fromStatus: TransferStatus | null
  toStatus: TransferStatus
  reason: string | null
  at: string
}

export interface TransferWithEvents extends Transfer {
  amounts: TransferAmount[]
  events: TransferEvent[]
}

/** What an amount is: the request amount, a priced component, or the derived net amount. */
export type AmountType =
  | 'amount'
  | 'selling_price'
  | 'fee_from_customer'
  | 'fee_from_partner'
  | 'commission_to_agent_1'
  | 'commission_to_partner'
  | 'withholding_tax'
  | 'discount'
  | 'cash_back'
  | 'cancellation_fee'
  | 'commission_to_agent_2'
  | 'purchasing_cost'
  | 'vat'
  | 'platform_commission'
  | 'net_amount'
  | 'service_charge'

export interface LedgerPosting {
  source: string
  destination: string
  asset: string
  amount: string
  /** The movement entries this posting settles: debited as one amount type, credited as another. */
  debitType: AmountType | null
  creditType: AmountType | null
}

export interface LedgerTransaction {
  id: number
  timestamp: string
  reference?: string
  reverted: boolean
  metadata: Record<string, string>
  postings: LedgerPosting[]
}

export interface Service {
  id: string
  serviceCode: string
  serviceName: string
  status: 'active' | 'suspended' | 'inactive'
}
