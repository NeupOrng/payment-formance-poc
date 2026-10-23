// End-to-end smoke test against the local stack (docker compose up + payment seed).
//   node architecture/scripts/smoke.mjs
const CUSTOMER = process.env.CUSTOMER_URL ?? 'http://localhost:4001';
const PAYMENT = process.env.PAYMENT_URL ?? 'http://localhost:4002';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ${detail}`}`);
  if (!ok) failures++;
};

async function call(method, url, body, key) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(key && { 'idempotency-key': key }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const key = () => crypto.randomUUID();
const json = (r) => JSON.stringify(r.body);
const balance = async (customerId, currency) =>
  (await call('GET', `${PAYMENT}/customers/${customerId}/balances`)).body.find((b) => b.currency === currency).balance;
const run = (service, command, body, k = key()) => call('POST', `${PAYMENT}/services/${service}/${command}`, body, k);
const amountOf = (transfer, type) => transfer.amounts?.find((a) => a.amountType === type)?.amount;
const newCustomer = async (name) =>
  (await call('POST', `${CUSTOMER}/customers`, { fullName: name, phoneNumber: `+855${Math.floor(Math.random() * 1e9)}` })).body;
const topup = (customerId, currency, amount) =>
  call('POST', `${PAYMENT}/topups`, { customerId, currency, amount, externalRef: `bank-${key()}` }, key());

const customer = await newCustomer('Smoke Test');
check('customer created with USD + KHR accounts', customer?.accounts?.length === 2, JSON.stringify(customer));
const id = customer.id;

// Top-up, replayed with the same Idempotency-Key
const topupKey = key();
const topupBody = { customerId: id, currency: 'USD', amount: '20000', externalRef: `bank-${topupKey}` };
const t1 = await call('POST', `${PAYMENT}/topups`, topupBody, topupKey);
const t2 = await call('POST', `${PAYMENT}/topups`, topupBody, topupKey);
check('top-up posted', t1.body?.status === 'posted', json(t1));
check('top-up replay returns the same transfer', !!t1.body?.id && t1.body.id === t2.body?.id);
check('USD balance = 20000 after top-up', (await balance(id, 'USD')) === '20000');

// EDC bill: payer debited selling price = amount + fee; partner pays 1% commission; VAT 10% of fee
const p1 = await run('EDC_BILL', 'payment', { source: id, currency: 'USD', amount: '10000' });
const amounts = Object.fromEntries((p1.body?.amounts ?? []).map((a) => [a.amountType, a.amount]));
check('bill payment posted', p1.body?.status === 'posted', json(p1));
check(
  'amount types priced from tiers (selling 10025, fee 25, commission 100, VAT 3, agent 10, net 9900)',
  amounts.selling_price === '10025' && amounts.fee_from_customer === '25' && amounts.platform_commission === '100' &&
    amounts.vat === '3' && amounts.commission_to_agent_1 === '10' && amounts.net_amount === '9900',
  JSON.stringify(amounts),
);
check('USD balance = 9975 after payment (source net −10025)', (await balance(id, 'USD')) === '9975' && p1.body?.sourceNet === '-10025');

const ledger = (await call('GET', `${PAYMENT}/transfers/${p1.body.id}/ledger`)).body;
check(
  'ledger postings carry debit/credit amount types',
  ledger?.postings?.[0]?.debitType === 'selling_price' && ledger.postings[0].creditType === 'amount' && ledger.postings[1].creditType === 'fee_from_customer',
  JSON.stringify(ledger?.postings),
);

// Insufficient funds → failed, nothing moved
const p2 = await run('EDC_BILL', 'payment', { source: id, currency: 'USD', amount: '50000' });
check('payment above balance fails', p2.body?.status === 'failed' && p2.body?.failureReason === 'insufficient_fund', json(p2));
check('USD balance unchanged after failed payment', (await balance(id, 'USD')) === '9975');

// Partial refund, then cancel is refused, then over-refund is refused
const r1 = await run('EDC_BILL', 'refund', { currency: 'USD', amount: '4000', originalTransferId: p1.body.id });
check('partial refund posted', r1.body?.status === 'posted', json(r1));
check('USD balance = 13975 after refund', (await balance(id, 'USD')) === '13975');
const c1 = await run('EDC_BILL', 'cancel', { currency: 'USD', originalTransferId: p1.body.id });
check('cancel after a refund is rejected (422)', c1.status === 422, json(c1));
const r2 = await run('EDC_BILL', 'refund', { currency: 'USD', amount: '7000', originalTransferId: p1.body.id });
check('refund above remaining amount is rejected (422)', r2.status === 422, json(r2));

// Cancel uses its own rules: customer gets net amount = amount − cancellation fee ($0.50)
const p3 = await run('EDC_BILL', 'payment', { source: id, currency: 'USD', amount: '5000' });
const c2 = await run('EDC_BILL', 'cancel', { currency: 'USD', originalTransferId: p3.body.id });
check('cancel posted with cancellation fee 50', c2.body?.status === 'posted' && amountOf(c2.body, 'cancellation_fee') === '50', json(c2));
check('USD balance = 13900 after pay 5025 + cancel 4950', (await balance(id, 'USD')) === '13900');

// Payment replay with the same Idempotency-Key
const k = key();
const p4 = await run('EDC_BILL', 'payment', { source: id, currency: 'USD', amount: '1000' }, k);
const p5 = await run('EDC_BILL', 'payment', { source: id, currency: 'USD', amount: '1000' }, k);
check('payment replay returns the same transfer', !!p4.body?.id && p4.body.id === p5.body?.id);
check('USD balance charged once (13900 − 1025 = 12875)', (await balance(id, 'USD')) === '12875');

// KHR uses its own tiers (៛1,000.00 fee up to ៛400,000.00)
await topup(id, 'KHR', '1000000');
const pk = await run('EDC_BILL', 'payment', { source: id, currency: 'KHR', amount: '200000' });
check('KHR payment posted with fee 100000', pk.body?.status === 'posted' && amountOf(pk.body, 'fee_from_customer') === '100000', json(pk));
check('KHR balance = 700000', (await balance(id, 'KHR')) === '700000');

// Concurrency: 12875 available, 10 parallel payments costing 2025 each → exactly 6 succeed
const results = await Promise.all(Array.from({ length: 10 }, () => run('EDC_BILL', 'payment', { source: id, currency: 'USD', amount: '2000' })));
const posted = results.filter((r) => r.body?.status === 'posted').length;
const afterRace = BigInt(await balance(id, 'USD'));
check(`concurrent payments: ${posted} posted, balance never negative`, posted === 6 && afterRace === 12875n - 6n * 2025n, `posted=${posted} balance=${afterRace}`);

// Cash back from the marketing budget
await topup(id, 'USD', '10000');
const mt = await run('MOBILE_TOPUP', 'payment', { source: id, currency: 'USD', amount: '500' });
check('top-up with 2% cash back: customer net −490', mt.body?.status === 'posted' && mt.body?.sourceNet === '-490', json(mt));

// P2P: source pays amount + service charge, destination receives amount and sees it in its history
const friend = await newCustomer('Smoke Friend');
const p2p = await run('P2P_TRANSFER', 'payment', { source: id, destination: friend.id, currency: 'USD', amount: '200' });
check('P2P posted: source −210, destination +200', p2p.body?.sourceNet === '-210' && p2p.body?.destinationNet === '200', json(p2p));
const friendHistory = (await call('GET', `${PAYMENT}/transfers?customerId=${friend.id}`)).body;
check('destination sees the transfer in its history', friendHistory?.some((t) => t.id === p2p.body?.id));
const p2pNoDest = await run('P2P_TRANSFER', 'payment', { source: id, currency: 'USD', amount: '200' });
check('P2P without destination is rejected (400)', p2pNoDest.status === 400, json(p2pNoDest));

// The spec example (MERCHANT_QR): ≤ $40, selling price = amount + 5%, fee = 5%
const qr = await run('MERCHANT_QR', 'payment', { source: id, destination: friend.id, currency: 'USD', amount: '2000' });
check('merchant QR: payer −2100 (selling price), merchant +2000', qr.body?.sourceNet === '-2100' && qr.body?.destinationNet === '2000', json(qr));
const qrBig = await run('MERCHANT_QR', 'payment', { source: id, destination: friend.id, currency: 'USD', amount: '5000' });
check('merchant QR above $40 is rejected (422)', qrBig.status === 422, json(qrBig));
const qrKhr = await run('MERCHANT_QR', 'payment', { source: id, destination: friend.id, currency: 'KHR', amount: '1000' });
check('merchant QR in KHR (not configured) is rejected (422)', qrKhr.status === 422, json(qrKhr));

// The dedicated payment API: POST /payments, then refund / cancel by payment id
const pay = await call('POST', `${PAYMENT}/payments`, { serviceCode: 'MERCHANT_QR', amount: '1000', currency: 'USD', source: id, destination: friend.id }, key());
check('POST /payments posts a payment (payer −1050, payee +1000)', pay.body?.status === 'posted' && pay.body.sourceNet === '-1050' && pay.body.destinationNet === '1000', json(pay));
const refundAll = await call('POST', `${PAYMENT}/payments/${pay.body.id}/refund`, {}, key());
check('POST /payments/:id/refund refunds the remaining amount', refundAll.body?.status === 'posted' && refundAll.body.amount === '1000', json(refundAll));
const bill = await call('POST', `${PAYMENT}/payments`, { serviceCode: 'EDC_BILL', amount: '2000', currency: 'USD', source: id }, key());
const cancelBill = await call('POST', `${PAYMENT}/payments/${bill.body?.id}/cancel`, undefined, key());
check('POST /payments/:id/cancel cancels with the cancellation fee', cancelBill.body?.status === 'posted' && cancelBill.body.sourceNet === '1950', json(cancelBill));

// An unbalanced movement cannot be saved
const bad = await call('POST', `${PAYMENT}/services/MERCHANT_QR/commands/payment/movement/check`, {
  entries: [
    { entryNo: 1, side: 'debit', account: '{source}', amountType: 'selling_price' },
    { entryNo: 2, side: 'credit', account: '{destination}', amountType: 'amount' },
  ],
});
check('movement check reports an unbalanced movement', bad.body?.balanced === false && bad.body.problems.length > 0, json(bad));

// Disabled service
await call('PATCH', `${PAYMENT}/services/MOBILE_TOPUP`, { status: 'suspended' });
const ps = await run('MOBILE_TOPUP', 'payment', { source: id, currency: 'USD', amount: '100' });
check('payment to a suspended service is rejected (422)', ps.status === 422, json(ps));
await call('PATCH', `${PAYMENT}/services/MOBILE_TOPUP`, { status: 'active' });

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
