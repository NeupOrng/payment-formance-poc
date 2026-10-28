const SYMBOLS: Record<string, string> = { USD: '$', KHR: '៛' }

/** Formats a decimal string ("1234.5") as money without floating point: $1,234.50. */
export function formatMoney(value: string | null | undefined, currency: string) {
  if (value === null || value === undefined) return '—'
  const negative = value.startsWith('-')
  const [whole = '0', frac = ''] = value.replace('-', '').split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '−' : ''}${SYMBOLS[currency] ?? ''}${grouped}.${frac.padEnd(2, '0').slice(0, 2)}`
}

export function isPositive(value: string | null | undefined) {
  return !!value && !value.startsWith('-') && /[1-9]/.test(value)
}

export function isNegative(value: string | null | undefined) {
  return !!value && value.startsWith('-') && /[1-9]/.test(value)
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

const ACRONYMS = new Set(['vat', 'kyc', 'spi', 'usd', 'khr', 'qr', 'p2p'])

/** AMOUNT_TYPE_CODE → "Amount type code" (acronyms stay upper case: VAT, KYC, …). */
export function humanize(code: string) {
  const words = code.toLowerCase().split('_').map(w => (ACRONYMS.has(w) ? w.toUpperCase() : w))
  const s = words.join(' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export const PRODUCT_LABELS: Record<ProductType, string> = {
  CURRENT: 'Current account',
  AGENT_FLOAT: 'Agent float',
  COMMISSION: 'Commission',
  INTERNAL: 'Internal',
}
