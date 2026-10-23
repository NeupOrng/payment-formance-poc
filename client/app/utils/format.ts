const SYMBOLS: Record<Currency, string> = { USD: '$', KHR: '៛' }

/** Formats an amount in the smallest unit (string of digits, 2 decimals) without floating point. */
export function formatMoney(minor: string | number | bigint, currency: Currency) {
  const value = BigInt(minor)
  const negative = value < 0n
  const abs = negative ? -value : value
  const whole = (abs / 100n).toLocaleString('en-US')
  const cents = (abs % 100n).toString().padStart(2, '0')
  return `${negative ? '-' : ''}${SYMBOLS[currency]}${whole}.${cents}`
}

/** The customer's net effect on a transfer: as payer (source) or payee (destination). */
export function netFor(transfer: Transfer, customerId: string): bigint {
  const net = transfer.sourceCustomerId === customerId ? transfer.sourceNet : transfer.destinationNet
  return BigInt(net ?? 0)
}

let dateTime: Intl.DateTimeFormat | undefined

export function formatDateTime(value: string) {
  dateTime ??= new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: useRuntimeConfig().public.timeZone,
  })
  return dateTime.format(new Date(value))
}

export function shortId(id: string) {
  return id.slice(0, 8)
}

export const AMOUNT_TYPE_LABELS: Record<AmountType, string> = {
  amount: 'Amount',
  selling_price: 'Selling price',
  fee_from_customer: 'Fee from customer',
  fee_from_partner: 'Fee from partner',
  commission_to_agent_1: 'Commission to agent 1',
  commission_to_partner: 'Commission to partner',
  withholding_tax: 'Withholding tax',
  discount: 'Discount',
  cash_back: 'Cash back',
  cancellation_fee: 'Cancellation fee',
  commission_to_agent_2: 'Commission to agent 2',
  purchasing_cost: 'Purchasing cost',
  vat: 'VAT',
  platform_commission: 'Platform commission',
  net_amount: 'Net amount',
  service_charge: 'Service charge',
}

export const TYPE_LABELS: Record<TransferType, string> = {
  payment: 'Payment',
  refund: 'Refund',
  cancel: 'Cancel',
  topup: 'Top-up',
}
