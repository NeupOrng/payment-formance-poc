/**
 * Seeds an example configuration through the Profile Service and Payment Engine APIs, so the same
 * validation applies as for an admin. Safe to run more than once: anything that exists is reused.
 *
 *   PROFILE_URL=http://localhost:4001 PAYMENT_URL=http://localhost:4002 npm run seed
 *
 * Amounts are decimal strings in the service currency.
 */
const PROFILE = process.env.PROFILE_URL ?? 'http://localhost:4001';
const PAYMENT = process.env.PAYMENT_URL ?? 'http://localhost:4002';

type Json = Record<string, any>;

async function call(method: string, url: string, body?: unknown, ok: number[] = []): Promise<{ status: number; body: any }> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok && !ok.includes(res.status)) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(json)}`);
  return { status: res.status, body: json };
}

// ------------------------------------------------------------------------- profiles and stocks

/** The bank's own profile and its INTERNAL accounts (one stock per currency). */
const BANK_ACCOUNTS = ['Settlement', 'Fee income', 'VAT payable', 'Marketing', 'EDC payable', 'Telco payable'];

async function profileNamed(type: string, fullName: string, extra: Json = {}) {
  const list = (await call('GET', `${PROFILE}/profiles?type=${type}&limit=200`)).body as Json[];
  const found = list.find((p) => p.fullName === fullName);
  if (found) return (await call('GET', `${PROFILE}/profiles/${found.id}`)).body;
  return (await call('POST', `${PROFILE}/profiles`, { profileType: type, fullName, ...extra })).body;
}

async function bank() {
  let profile = await profileNamed('INTERNAL', 'Mobile Bank');
  for (const name of BANK_ACCOUNTS) {
    if (!profile.accounts.some((a: Json) => a.name === name)) {
      profile = (await call('POST', `${PROFILE}/profiles/${profile.id}/accounts`, { productType: 'INTERNAL', name, currencies: ['USD', 'KHR'] })).body;
    }
  }
  return profile;
}

const stockOf = (profile: Json, account: (a: Json) => boolean, currency: string): string =>
  profile.accounts.find(account).stocks.find((s: Json) => s.currency === currency).id;

// ------------------------------------------------------------------------- configuration

const AMOUNT_TYPES: [string, string][] = [
  ['AMOUNT', 'Amount'],
  ['SELLING_PRICE', 'Selling price'],
  ['FEE_FROM_CUSTOMER', 'Fee from customer'],
  ['FEE_FROM_PARTNER', 'Fee from partner'],
  ['COMMISSION_TO_AGENT_1', 'Commission to agent 1'],
  ['COMMISSION_TO_PARTNER', 'Commission to partner'],
  ['WITHHOLDING_TAX', 'Withholding tax'],
  ['DISCOUNT', 'Discount'],
  ['CASH_BACK', 'Cash back'],
  ['CANCELLATION_FEE', 'Cancellation fee'],
  ['COMMISSION_TO_AGENT_2', 'Commission to agent 2'],
  ['PURCHASING_COST', 'Purchasing cost'],
  ['VAT', 'VAT'],
  ['PLATFORM_COMMISSION', 'Platform commission'],
  ['NET_AMOUNT', 'Net amount'],
  ['SERVICE_CHARGE', 'Service charge'],
];

const SPIS = [
  {
    code: 'EDC_BILLER',
    name: 'EDC biller API (partner-mock)',
    spiType: 'EXTERNAL',
    external: { baseUrl: 'http://partner-mock:3000', protocol: 'REST', authType: 'NONE', timeoutMs: 2_500, maxRetries: 1 },
  },
  { code: 'SANCTIONS', name: 'Sanctions screening', spiType: 'INTERNAL', internal: { handlerName: 'sanctions-screening', timeoutMs: 2_000 } },
  { code: 'PUSH', name: 'Push notification', spiType: 'INTERNAL', internal: { handlerName: 'push-notification', timeoutMs: 2_000 } },
];

// Rule and movement builders
const fixed = (amountType: string, calcSequence: number, fixedValue: string, extra: Json = {}) => ({ amountType, calcSequence, calcMethod: 'FIXED', fixedValue, ...extra });
const percent = (amountType: string, calcSequence: number, percentage: string, baseAmountType = 'AMOUNT', extra: Json = {}) => ({
  amountType,
  calcSequence,
  calcMethod: 'FIXED',
  baseAmountType,
  percentage,
  ...extra,
});
const formula = (amountType: string, calcSequence: number, formulaExpression: string) => ({ amountType, calcSequence, calcMethod: 'FORMULA', formulaExpression });
type End = 'PAYER' | 'PAYEE' | string; // a role, or a stock id (SPECIFIC)
const move = (movementSequence: number, amountType: string, from: End, to: End) => ({
  movementSequence,
  amountType,
  ...(from === 'PAYER' || from === 'PAYEE' ? { fromStockRole: from } : { fromStockRole: 'SPECIFIC', fromStockId: from }),
  ...(to === 'PAYER' || to === 'PAYEE' ? { toStockRole: to } : { toStockRole: 'SPECIFIC', toStockId: to }),
});

type Command = { tiers: Json[]; spis?: [string, string, number, string][] };
type ServiceDef = { group: string; code: string; name: string; currency: string; commands: Record<string, Command> };

function services(b: Json, agent: Json): ServiceDef[] {
  const s = (name: string, ccy: string) => stockOf(b, (a) => a.name === name, ccy);
  const agentCommission = (ccy: string) => stockOf(agent, (a) => a.productType === 'COMMISSION', ccy);
  const backToPayer = { tiers: [{ rules: [], movements: [move(1, 'AMOUNT', 'PAYEE', 'PAYER')] }] };

  const cashIn = (ccy: string): ServiceDef => ({
    group: 'Cash-in',
    code: `CASH_IN_${ccy}`,
    name: `Cash-in from partner bank (${ccy})`,
    currency: ccy,
    commands: { PAYMENT: { tiers: [{ rules: [], movements: [move(1, 'AMOUNT', 'PAYER', 'PAYEE')] }] } },
  });

  const p2p = (ccy: string, charge: string): ServiceDef => ({
    group: 'Transfers',
    code: `P2P_${ccy}`,
    name: `Send money (${ccy})`,
    currency: ccy,
    commands: {
      PAYMENT: {
        tiers: [
          {
            rules: [fixed('SERVICE_CHARGE', 1, charge), formula('SELLING_PRICE', 2, 'AMOUNT + SERVICE_CHARGE')],
            movements: [move(1, 'AMOUNT', 'PAYER', 'PAYEE'), move(2, 'SERVICE_CHARGE', 'PAYER', s('Fee income', ccy))],
          },
        ],
        spis: [['SANCTIONS', 'PRE_PAYMENT', 1, 'screen payer and payee'], ['PUSH', 'NOTIFICATION', 1, 'payment completed']],
      },
      REFUND: backToPayer,
    },
  });

  // Bill payment: the payee is the bank's EDC payable account; the biller validates the bill before
  // and confirms it after the money moves. The biller pays the bank 1%, VAT is 10% of the fee, and
  // agent 1 earns a fixed commission out of fee income.
  const billRules = (fee: Json) => [
    fee,
    formula('SELLING_PRICE', 2, 'AMOUNT + FEE_FROM_CUSTOMER'),
    percent('PLATFORM_COMMISSION', 3, '1'),
    percent('VAT', 4, '10', 'FEE_FROM_CUSTOMER'),
    fixed('COMMISSION_TO_AGENT_1', 5, '0.10'),
    formula('NET_AMOUNT', 6, 'AMOUNT - PLATFORM_COMMISSION'),
  ];
  const billMovements = [
    move(1, 'AMOUNT', 'PAYER', 'PAYEE'),
    move(2, 'FEE_FROM_CUSTOMER', 'PAYER', s('Fee income', 'USD')),
    move(3, 'PLATFORM_COMMISSION', 'PAYEE', s('Fee income', 'USD')),
    move(4, 'VAT', s('Fee income', 'USD'), s('VAT payable', 'USD')),
    move(5, 'COMMISSION_TO_AGENT_1', s('Fee income', 'USD'), agentCommission('USD')),
  ];
  const cancelMovements = [move(1, 'NET_AMOUNT', 'PAYEE', 'PAYER'), move(2, 'CANCELLATION_FEE', 'PAYEE', s('Fee income', 'USD'))];

  return [
    cashIn('USD'),
    cashIn('KHR'),
    p2p('USD', '0.10'),
    p2p('KHR', '400.00'),
    {
      group: 'Bill payments',
      code: 'EDC_BILL_USD',
      name: 'Electricity bill (USD)',
      currency: 'USD',
      commands: {
        PAYMENT: {
          tiers: [
            // ≤ $100.00 → $0.25 fee; above → 0.25%, max $5.00
            { minAmount: '0.01', maxAmount: '100.01', rules: billRules(fixed('FEE_FROM_CUSTOMER', 1, '0.25')), movements: billMovements },
            { minAmount: '100.01', rules: billRules(percent('FEE_FROM_CUSTOMER', 1, '0.25', 'AMOUNT', { maxValue: '5.00' })), movements: billMovements },
          ],
          spis: [
            ['EDC_BILLER', 'PRE_PAYMENT', 1, 'POST /validations'],
            ['EDC_BILLER', 'POST_PAYMENT', 1, 'POST /confirmations'],
            ['PUSH', 'NOTIFICATION', 1, 'bill paid'],
          ],
        },
        REFUND: backToPayer,
        CANCEL: {
          tiers: [
            // Free below $10.00, then $0.50: the customer gets NET_AMOUNT = AMOUNT − CANCELLATION_FEE.
            { minAmount: '0.01', maxAmount: '10.00', rules: [fixed('CANCELLATION_FEE', 1, '0'), formula('NET_AMOUNT', 2, 'AMOUNT - CANCELLATION_FEE')], movements: cancelMovements },
            { minAmount: '10.00', rules: [fixed('CANCELLATION_FEE', 1, '0.50'), formula('NET_AMOUNT', 2, 'AMOUNT - CANCELLATION_FEE')], movements: cancelMovements },
          ],
        },
      },
    },
    {
      // The spec example: ≤ $40, selling price = amount + 5%, fee from customer = 5%.
      group: 'QR payments',
      code: 'MERCHANT_QR_USD',
      name: 'Merchant QR payment (USD)',
      currency: 'USD',
      commands: {
        PAYMENT: {
          tiers: [
            {
              minAmount: '0.01',
              maxAmount: '40.01',
              rules: [percent('FEE_FROM_CUSTOMER', 1, '5'), formula('SELLING_PRICE', 2, 'FEE_FROM_CUSTOMER + AMOUNT')],
              movements: [move(1, 'AMOUNT', 'PAYER', 'PAYEE'), move(2, 'FEE_FROM_CUSTOMER', 'PAYER', s('Fee income', 'USD'))],
            },
          ],
        },
        REFUND: backToPayer,
      },
    },
    {
      // Airtime with 2% cash back funded by the bank's marketing budget.
      group: 'Bill payments',
      code: 'MOBILE_TOPUP_USD',
      name: 'Mobile airtime top-up (USD)',
      currency: 'USD',
      commands: {
        PAYMENT: {
          tiers: [{ rules: [percent('CASH_BACK', 1, '2')], movements: [move(1, 'AMOUNT', 'PAYER', 'PAYEE'), move(2, 'CASH_BACK', s('Marketing', 'USD'), 'PAYER')] }],
        },
        CANCEL: {
          tiers: [{ rules: [percent('CASH_BACK', 1, '2')], movements: [move(1, 'AMOUNT', 'PAYEE', 'PAYER'), move(2, 'CASH_BACK', 'PAYER', s('Marketing', 'USD'))] }],
        },
      },
    },
  ];
}

// ------------------------------------------------------------------------- run

const b = await bank();
const agent = await profileNamed('AGENT', 'Agent Sokha', { kycVerified: true, phoneNumber: '+85510900001' });
console.log(`profiles: ${b.fullName} (${b.profileNumber}), ${agent.fullName} (${agent.profileNumber})`);

for (const [code, name] of AMOUNT_TYPES) await call('POST', `${PAYMENT}/amount-types`, { code, name }, [409]);
for (const spi of SPIS) await call('POST', `${PAYMENT}/spis`, spi, [409]);
console.log(`amount types: ${AMOUNT_TYPES.length}, SPIs: ${SPIS.map((s) => s.code).join(', ')}`);

const groups = new Map<string, string>(((await call('GET', `${PAYMENT}/service-groups`)).body as Json[]).map((g) => [g.name, g.id]));
for (const def of services(b, agent)) {
  if (!groups.has(def.group)) groups.set(def.group, (await call('POST', `${PAYMENT}/service-groups`, { name: def.group })).body.id);
  const created = await call('POST', `${PAYMENT}/services`, { serviceGroupId: groups.get(def.group), code: def.code, name: def.name, currency: def.currency }, [409]);
  if (created.status === 409) {
    console.log(`${def.code}: exists`);
    continue;
  }
  for (const [type, cmd] of Object.entries(def.commands)) {
    await call('PUT', `${PAYMENT}/services/${def.code}/commands/${type}`, {});
    for (const tier of cmd.tiers) await call('POST', `${PAYMENT}/services/${def.code}/commands/${type}/tiers`, tier);
    for (const [spiCode, triggerStage, executionSequence, spiOperation] of cmd.spis ?? []) {
      await call('POST', `${PAYMENT}/services/${def.code}/commands/${type}/spis`, { spiCode, triggerStage, executionSequence, spiOperation });
    }
  }
  console.log(`${def.code}: ${Object.keys(def.commands).join(', ')}`);
}
