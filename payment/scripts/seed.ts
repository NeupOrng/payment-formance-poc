/**
 * Seeds example services through the payment service API (so the same validation applies).
 * Each command is configured in order: settings → pricing tiers → balance movement (which the API
 * only accepts if debits equal credits). Safe to run more than once.
 *
 *   PAYMENT_URL=http://localhost:4002 npm run seed
 *
 * Amounts are in the smallest unit: USD/2 cents, KHR/2 (៛1.00 = 100).
 */
const BASE = process.env.PAYMENT_URL ?? 'http://localhost:4002';

type Entry = { entryNo: number; side: 'debit' | 'credit'; account: string; amountType: string; allowOverdraft?: boolean };
type Tier = Record<string, string | number | boolean>;
type CommandConfig = { settings?: Record<string, unknown>; tiers: Tier[]; movement: Entry[] };

/** Builds numbered entries: debit('{source}', 'selling_price'), credit('platform:fees:{service}', 'fee_from_customer'), … */
function movement(...entries: [Entry['side'], string, string, boolean?][]): Entry[] {
  return entries.map(([side, account, amountType, allowOverdraft], i) => ({
    entryNo: i + 1,
    side,
    account,
    amountType,
    ...(allowOverdraft && { allowOverdraft }),
  }));
}
/** The same rule for USD and KHR, with per-currency fixed amounts. */
const both = (tier: Tier, fixed?: { USD: string; KHR: string }, min?: { USD: string; KHR: string }): Tier[] =>
  (['USD', 'KHR'] as const).map((currency) => ({
    minAmount: min?.[currency] ?? '1',
    ...tier,
    currency,
    ...(fixed && { fixedAmount: fixed[currency] }),
  }));
/** A fee and the matching selling price (= amount + fee) for the same band. */
const feeAndSellingPrice = (feeType: string, band: Tier): Tier[] => [
  { ...band, amountType: feeType },
  { ...band, amountType: 'selling_price', includeBase: true },
];

const PARTNER = 'services:{service}';
const REVENUE = 'platform:revenue:{service}';

const SERVICES: { code: string; name: string; commands: Record<string, CommandConfig> }[] = [
  {
    // Customer pays a bill: selling price = amount + fee. The biller pays the platform 1%;
    // VAT is 10% of the customer fee; agent 1 earns a fixed commission.
    code: 'EDC_BILL',
    name: 'Electricity bill',
    commands: {
      payment: {
        settings: { netAmountSubtract: ['platform_commission'] },
        tiers: [
          // ≤ $100.00 → $0.25; above → 0.25%, max $5.00
          ...feeAndSellingPrice('fee_from_customer', { currency: 'USD', minAmount: '1', maxAmount: '10000', calcType: 'fixed', fixedAmount: '25' }),
          ...feeAndSellingPrice('fee_from_customer', { currency: 'USD', minAmount: '10001', calcType: 'percent', percentBps: 25, maxValue: '500' }),
          // ≤ ៛400,000 → ៛1,000; above → 0.25%, max ៛20,000
          ...feeAndSellingPrice('fee_from_customer', { currency: 'KHR', minAmount: '1', maxAmount: '40000000', calcType: 'fixed', fixedAmount: '100000' }),
          ...feeAndSellingPrice('fee_from_customer', { currency: 'KHR', minAmount: '40000001', calcType: 'percent', percentBps: 25, maxValue: '2000000' }),
          ...both({ amountType: 'platform_commission', calcType: 'percent', percentBps: 100 }),
          ...both({ amountType: 'vat', calcType: 'percent', percentBps: 1_000, baseAmountType: 'fee_from_customer' }),
          ...both({ amountType: 'commission_to_agent_1', calcType: 'fixed' }, { USD: '10', KHR: '40000' }),
        ],
        movement: movement(
          ['debit', '{source}', 'selling_price'],
          ['credit', PARTNER, 'amount'],
          ['credit', REVENUE, 'fee_from_customer'],
          ['debit', PARTNER, 'platform_commission'],
          ['credit', REVENUE, 'platform_commission'],
          ['debit', REVENUE, 'vat', true],
          ['credit', 'platform:tax:vat', 'vat'],
          ['debit', REVENUE, 'commission_to_agent_1', true],
          ['credit', 'agents:{service}:agent_1', 'commission_to_agent_1'],
        ),
      },
      refund: {
        settings: { allowPartial: true, maxAgeMinutes: 43_200 },
        tiers: [],
        movement: movement(['debit', PARTNER, 'amount'], ['credit', '{source}', 'amount']),
      },
      cancel: {
        // Customer gets net amount = amount − cancellation fee: none below $10.00 / ៛40,000, then fixed.
        settings: { maxAgeMinutes: 1_440, netAmountSubtract: ['cancellation_fee'] },
        tiers: [
          { amountType: 'cancellation_fee', currency: 'USD', minAmount: '1', maxAmount: '999', calcType: 'fixed', fixedAmount: '0' },
          { amountType: 'cancellation_fee', currency: 'KHR', minAmount: '1', maxAmount: '3999999', calcType: 'fixed', fixedAmount: '0' },
          ...both({ amountType: 'cancellation_fee', calcType: 'fixed' }, { USD: '50', KHR: '200000' }, { USD: '1000', KHR: '4000000' }),
        ],
        movement: movement(
          ['debit', PARTNER, 'amount'],
          ['credit', '{source}', 'net_amount'],
          ['credit', REVENUE, 'cancellation_fee'],
        ),
      },
    },
  },
  {
    // Airtime top-up with 2% cash back funded by the platform's marketing budget.
    code: 'MOBILE_TOPUP',
    name: 'Mobile airtime top-up',
    commands: {
      payment: {
        tiers: both({ amountType: 'cash_back', calcType: 'percent', percentBps: 200 }),
        movement: movement(
          ['debit', '{source}', 'amount'],
          ['credit', PARTNER, 'amount'],
          ['debit', 'platform:marketing', 'cash_back', true],
          ['credit', '{source}', 'cash_back'],
        ),
      },
      cancel: {
        settings: { maxAgeMinutes: 30 },
        tiers: both({ amountType: 'cash_back', calcType: 'percent', percentBps: 200 }),
        movement: movement(
          ['debit', PARTNER, 'amount'],
          ['credit', '{source}', 'amount'],
          ['debit', '{source}', 'cash_back'],
          ['credit', 'platform:marketing', 'cash_back'],
        ),
      },
    },
  },
  {
    // The example from the spec, USD only: ≤ $40, selling price = amount + 5%, fee from customer = 5%.
    // Debit the payer the selling price, credit the merchant the amount and the fee account the fee.
    code: 'MERCHANT_QR',
    name: 'Merchant QR payment',
    commands: {
      payment: {
        tiers: [
          { amountType: 'selling_price', currency: 'USD', minAmount: '1', maxAmount: '4000', calcType: 'percent', percentBps: 500, includeBase: true },
          { amountType: 'fee_from_customer', currency: 'USD', minAmount: '1', maxAmount: '4000', calcType: 'percent', percentBps: 500 },
        ],
        movement: movement(
          ['debit', '{source}', 'selling_price'],
          ['credit', '{destination}', 'amount'],
          ['credit', 'platform:fees:{service}', 'fee_from_customer'],
        ),
      },
      refund: {
        settings: { allowPartial: true, maxAgeMinutes: 10_080 },
        tiers: [],
        movement: movement(['debit', '{destination}', 'amount'], ['credit', '{source}', 'amount']),
      },
    },
  },
  {
    // Customer-to-customer transfer: payer is debited the selling price (amount + service charge).
    code: 'P2P_TRANSFER',
    name: 'Send money',
    commands: {
      payment: {
        tiers: [
          ...both({ amountType: 'service_charge', calcType: 'fixed' }, { USD: '10', KHR: '40000' }),
          ...both({ amountType: 'selling_price', calcType: 'fixed', includeBase: true }, { USD: '10', KHR: '40000' }),
        ],
        movement: movement(
          ['debit', '{source}', 'selling_price'],
          ['credit', '{destination}', 'amount'],
          ['credit', 'platform:fees:{service}', 'service_charge'],
        ),
      },
      refund: {
        settings: { maxAgeMinutes: 60 },
        tiers: [],
        movement: movement(['debit', '{destination}', 'amount'], ['credit', '{source}', 'amount']),
      },
    },
  },
];

async function call(method: string, path: string, body: unknown, okStatuses: number[] = []) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok && !okStatuses.includes(res.status)) {
    throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  }
  return res.status;
}

for (const service of SERVICES) {
  const created = await call('POST', '/services', { serviceCode: service.code, serviceName: service.name }, [409]);
  console.log(`${service.code}: ${created === 409 ? 'exists' : 'created'}`);

  for (const [command, config] of Object.entries(service.commands)) {
    const path = `/services/${service.code}/commands/${command}`;
    await call('PUT', path, config.settings ?? {});
    let added = 0;
    for (const tier of config.tiers) {
      if ((await call('POST', `${path}/pricing-tiers`, tier, [409])) !== 409) added++;
    }
    await call('PUT', `${path}/movement`, { entries: config.movement });
    console.log(`  ${command}: ${added} new pricing tiers, ${config.movement.length} movement entries (balanced)`);
  }
}
