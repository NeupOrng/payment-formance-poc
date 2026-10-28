// End-to-end smoke test against the local stack (task up + task seed).
//   node architecture/scripts/smoke.mjs
const PROFILE = process.env.PROFILE_URL ?? 'http://localhost:4001';
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
const json = (r) => JSON.stringify(r.body)?.slice(0, 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const phone = () => `+8551${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const usdStock = (profile) => profile.accounts.flatMap((a) => a.stocks).find((s) => s.currency === 'USD');
const live = async (stockId) => (await call('GET', `${PAYMENT}/stocks/${stockId}/ledger-balance`)).body;
const amountOf = (order, type) => order.amounts?.find((a) => a.amountType === type)?.amount;
/** The Profile Service mirrors balances from ledger events; give it a moment, then read the stock. */
async function mirrored(profileId, expected) {
  let stock;
  for (let i = 0; i < 20; i++) {
    stock = usdStock((await call('GET', `${PROFILE}/profiles/${profileId}`)).body);
    if (!expected || stock.ledgerBalance === expected) break;
    await sleep(250);
  }
  return stock;
}

// ---------------------------------------------------------------- setup: bank (seeded) and customers
const internal = (await call('GET', `${PROFILE}/profiles?type=INTERNAL`)).body;
const bankRow = internal?.find((p) => p.fullName === 'Mobile Bank');
if (!bankRow) {
  console.log('FAIL  bank profile not found — run `task seed` first');
  process.exit(1);
}
const bank = (await call('GET', `${PROFILE}/profiles/${bankRow.id}`)).body;
const bankStock = (name) => usdStock({ accounts: bank.accounts.filter((a) => a.name === name) }).id;
const SETTLEMENT = bankStock('Settlement');
const EDC = bankStock('EDC payable');
const FEES = bankStock('Fee income');

const pending = await call('POST', `${PROFILE}/profiles`, { profileType: 'INDIVIDUAL', fullName: 'No KYC', phoneNumber: phone() });
check('new individual without KYC is PENDING_KYC with USD + KHR stocks', pending.body?.status === 'PENDING_KYC' && pending.body.accounts[0].stocks.length === 2, json(pending));
const activate = await call('PATCH', `${PROFILE}/profiles/${pending.body.id}/status`, { status: 'ACTIVE' });
check('a profile cannot become ACTIVE before KYC (422)', activate.status === 422, json(activate));

const dara = (await call('POST', `${PROFILE}/profiles`, { profileType: 'INDIVIDUAL', fullName: 'Smoke Dara', phoneNumber: phone(), kycVerified: true })).body;
const sophea = (await call('POST', `${PROFILE}/profiles`, { profileType: 'INDIVIDUAL', fullName: 'Smoke Sophea', phoneNumber: phone(), kycVerified: true })).body;
const D = usdStock(dara).id;
const S = usdStock(sophea).id;
check('KYC-verified individual is ACTIVE', dara.status === 'ACTIVE');
check('stock ledger account uses ids only', /^individual:cif\d+:current:\d+$/.test(usdStock(dara).ledgerAccount), usdStock(dara).ledgerAccount);

const pay = (body, k = key()) => call('POST', `${PAYMENT}/payments`, body, k);
const authorize = (id) => call('POST', `${PAYMENT}/payments/${id}/authorize`, {});

// ---------------------------------------------------------------- cash-in (bank → customer, no authorization)
const cashKey = key();
const cash = await pay({ serviceCode: 'CASH_IN_USD', amount: '200.00', payerStockId: SETTLEMENT, payeeStockId: D }, cashKey);
check('cash-in from the bank completes without authorization', cash.status === 201 && cash.body?.status === 'COMPLETED', json(cash));
const cashAgain = await pay({ serviceCode: 'CASH_IN_USD', amount: '200.00', payerStockId: SETTLEMENT, payeeStockId: D }, cashKey);
check('same Idempotency-Key returns the same order', cashAgain.body?.id === cash.body?.id, json(cashAgain));
check('Profile Service mirrors the balance from ledger events', (await mirrored(dara.id, '200.00')).ledgerBalance === '200.00');

// ---------------------------------------------------------------- the spec example: merchant QR, ≤ $40
const qr = await pay({ serviceCode: 'MERCHANT_QR_USD', amount: '20.00', payerStockId: D, payeeStockId: S });
check('QR payment is PENDING, awaiting authorization', qr.status === 201 && qr.body?.status === 'PENDING', json(qr));
check('priced by the tier: fee 1.00, selling price 21.00', amountOf(qr.body, 'FEE_FROM_CUSTOMER') === '1.00' && amountOf(qr.body, 'SELLING_PRICE') === '21.00', json(qr));
const held = await live(D);
check('selling price is held while waiting (available 179.00, hold 21.00)', held.availableBalance === '179.00' && held.holdAmount === '21.00', JSON.stringify(held));
const heldMirror = await mirrored(dara.id, '200.00');
check('mirror shows the hold too', heldMirror.holdAmount === '21.00' && heldMirror.availableBalance === '179.00', JSON.stringify(heldMirror));

const auth = await authorize(qr.body.id);
check('authorize → COMPLETED (PENDING → PROCESSING → COMPLETED)', auth.body?.status === 'COMPLETED' && auth.body.history.map((h) => h.toStatus).join('>') === 'PENDING>PROCESSING>COMPLETED', json(auth));
check('movements posted: payer → payee 20.00, payer → fee income 1.00', auth.body?.movements?.map((m) => `${m.amountType}:${m.amount}:${m.status}`).join(',') === 'AMOUNT:20.00:POSTED,FEE_FROM_CUSTOMER:1.00:POSTED', json(auth));
check('authorizing twice is refused (409)', (await authorize(qr.body.id)).status === 409);
check('Dara 179.00, Sophea 20.00', (await live(D)).ledgerBalance === '179.00' && (await live(S)).ledgerBalance === '20.00');
const ledgerTx = (await call('GET', `${PAYMENT}/payments/${qr.body.id}/ledger`)).body;
check('ledger: RESERVE and SETTLE posted, RELEASE / REVERT not needed', ledgerTx?.map((t) => `${t.step}:${t.status}`).join(' ') === 'RESERVE:POSTED SETTLE:POSTED REVERT:PLANNED RELEASE:PLANNED', JSON.stringify(ledgerTx?.map((t) => [t.step, t.status])));
check('settle postings carry stock ids and amount types', ledgerTx?.find((t) => t.step === 'SETTLE')?.postings.every((p) => p.amountType && p.fromStockId && p.toStockId));

const big = await pay({ serviceCode: 'MERCHANT_QR_USD', amount: '50.00', payerStockId: D, payeeStockId: S });
check('amount outside every tier is rejected (422)', big.status === 422, json(big));

// ---------------------------------------------------------------- bill payment: SPIs and compensation
const bill = async (ref, amount = '10.00') => {
  const created = await pay({ serviceCode: 'EDC_BILL_USD', amount, payerStockId: D, payeeStockId: EDC, externalReference: ref });
  return created.status === 201 && created.body.status === 'PENDING' ? authorize(created.body.id) : created;
};
const invalid = await bill('INVALID-1');
check('biller rejects the bill (PRE_PAYMENT) → FAILED, hold released', invalid.body?.status === 'FAILED' && invalid.body.statusReasonCode === 'PRE_PAY_REJECTED', json(invalid));
const rejected = await bill('REJECT-1');
check('biller rejects the confirmation (POST_PAYMENT) → FAILED', rejected.body?.status === 'FAILED' && rejected.body.statusReasonCode === 'POST_PAY_REJECTED', json(rejected));
check('…movements REVERTED, ledger RESERVE/SETTLE/REVERT/RELEASE all posted', rejected.body?.movements?.every((m) => m.status === 'REVERSED') && rejected.body.ledgerTransactions.every((t) => t.status === 'POSTED'), json(rejected));
check('Dara unchanged after both (179.00)', (await live(D)).availableBalance === '179.00');
const paid = await bill('BILL-001');
check('bill paid: selling price 10.25, VAT 0.03, agent commission 0.10, net 9.90', paid.body?.status === 'COMPLETED' && amountOf(paid.body, 'SELLING_PRICE') === '10.25' && amountOf(paid.body, 'VAT') === '0.03' && amountOf(paid.body, 'COMMISSION_TO_AGENT_1') === '0.10' && amountOf(paid.body, 'NET_AMOUNT') === '9.90', json(paid));
check('Dara 168.75', (await live(D)).ledgerBalance === '168.75');

// ---------------------------------------------------------------- cancel and refund
const waiting = await pay({ serviceCode: 'MERCHANT_QR_USD', amount: '5.00', payerStockId: D, payeeStockId: S });
const cancelled = await call('POST', `${PAYMENT}/payments/${waiting.body.id}/cancel`, undefined, key());
check('cancel before authorization → CANCELLED, hold released', cancelled.body?.status === 'CANCELLED' && cancelled.body.statusReasonCode === 'CANCELLED_BY_USER', json(cancelled));
check('Dara back to 168.75 available', (await live(D)).availableBalance === '168.75');

const r1 = await call('POST', `${PAYMENT}/payments/${qr.body.id}/refund`, { amount: '5.00' }, key());
check('partial refund (5.00) completes', r1.body?.status === 'COMPLETED' && r1.body.originalOrderId === qr.body.id, json(r1));
const tooMuch = await call('POST', `${PAYMENT}/payments/${qr.body.id}/refund`, { amount: '20.00' }, key());
check('refund above the rest is rejected (422)', tooMuch.status === 422, json(tooMuch));
const r2 = await call('POST', `${PAYMENT}/payments/${qr.body.id}/refund`, {}, key());
check('refund of the rest (15.00) completes', r2.body?.status === 'COMPLETED' && r2.body.amount === '15.00', json(r2));
const original = (await call('GET', `${PAYMENT}/payments/${qr.body.id}`)).body;
check('fully refunded original becomes REVERSED', original.status === 'REVERSED' && original.statusReasonCode === 'FULLY_REFUNDED', json({ body: original }));

const billCancel = await call('POST', `${PAYMENT}/payments/${paid.body.id}/cancel`, undefined, key());
check('cancel a completed bill → CANCEL order, payer gets 9.50 (fee 0.50)', billCancel.body?.status === 'COMPLETED' && amountOf(billCancel.body, 'NET_AMOUNT') === '9.50' && amountOf(billCancel.body, 'CANCELLATION_FEE') === '0.50', json(billCancel));
check('Dara 198.25 (168.75 + 20.00 refunded + 9.50)', (await live(D)).ledgerBalance === '198.25');

// ---------------------------------------------------------------- insufficient funds and concurrency
const broke = await pay({ serviceCode: 'MERCHANT_QR_USD', amount: '40.00', payerStockId: S, payeeStockId: D });
check('insufficient funds → FAILED at reserve, nothing held', broke.body?.status === 'FAILED' && broke.body.statusReasonCode === 'INSUFFICIENT_FUNDS', json(broke));

// Dara has 198.25; ten parallel QR payments of 30.00 (31.50 with fee) can only reserve six.
const burst = await Promise.all(Array.from({ length: 10 }, () => pay({ serviceCode: 'MERCHANT_QR_USD', amount: '30.00', payerStockId: D, payeeStockId: S })));
const reservedOk = burst.filter((r) => r.body?.status === 'PENDING');
const after = await live(D);
check(`concurrent reserves: ${reservedOk.length} held, never over-reserved`, reservedOk.length === 6 && after.holdAmount === '189.00' && after.availableBalance === '9.25', `held=${reservedOk.length} ${JSON.stringify(after)}`);
await Promise.all(reservedOk.map((r) => call('POST', `${PAYMENT}/payments/${r.body.id}/cancel`, undefined, key())));
check('cancelling them releases every hold', (await live(D)).availableBalance === '198.25');

// ---------------------------------------------------------------- configuration guards
const svc = (await call('GET', `${PAYMENT}/services/MERCHANT_QR_USD`)).body;
const badTier = await call('POST', `${PAYMENT}/services/MERCHANT_QR_USD/commands/PAYMENT/tiers`, {
  minAmount: '100.00',
  rules: [{ amountType: 'SELLING_PRICE', calcSequence: 1, calcMethod: 'FORMULA', formulaExpression: 'AMOUNT + FEE_FROM_CUSTOMER' }],
  movements: [{ movementSequence: 1, amountType: 'AMOUNT', fromStockRole: 'PAYER', toStockRole: 'PAYEE' }],
});
check('tier using an amount type not calculated earlier is rejected (400)', badTier.status === 400 && JSON.stringify(badTier.body).includes('not AMOUNT or calculated earlier'), json(badTier));
const overlap = await call('POST', `${PAYMENT}/services/MERCHANT_QR_USD/commands/PAYMENT/tiers`, {
  minAmount: '10.00',
  maxAmount: '20.00',
  rules: [],
  movements: [{ movementSequence: 1, amountType: 'AMOUNT', fromStockRole: 'PAYER', toStockRole: 'PAYEE' }],
});
check('overlapping active tier is rejected (409)', overlap.status === 409, json(overlap));
const preview = await call('POST', `${PAYMENT}/tiers/${svc.commands.find((c) => c.commandType === 'PAYMENT').tiers[0].id}/preview`, { amount: '40.00' });
check('tier preview: 40.00 → fee 2.00, selling price 42.00', preview.body?.amounts?.FEE_FROM_CUSTOMER === '2.00' && preview.body.amounts.SELLING_PRICE === '42.00', json(preview));

await call('PATCH', `${PAYMENT}/services/MERCHANT_QR_USD`, { status: 'INACTIVE' });
const off = await pay({ serviceCode: 'MERCHANT_QR_USD', amount: '1.00', payerStockId: D, payeeStockId: S });
check('payment to an INACTIVE service is rejected (422)', off.status === 422, json(off));
await call('PATCH', `${PAYMENT}/services/MERCHANT_QR_USD`, { status: 'ACTIVE' });

const fees = await live(FEES);
check('fee income is a positive INTERNAL balance', Number(fees.ledgerBalance) > 0, JSON.stringify(fees));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
