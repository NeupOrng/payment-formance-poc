// Mock partner (biller) called by the payment engine's SPIs. No dependencies.
//
//   POST /validations    PRE_PAYMENT:  is the bill payable?
//     → 200 { status: "valid" }  ·  422 { reason } when externalReference starts with INVALID
//   POST /confirmations  POST_PAYMENT: confirm the paid bill
//     → 200 { status: "confirmed", partnerRef }   approve
//     → 422 { status: "rejected", reason }         reject  (saga reverts the movements, releases the hold)
//     → no answer                                   timeout (saga gives up the same way)
//
// Body: { reference (order id), orderReference, serviceCode, amount, currency, externalReference, … }.
// Confirmation behaviour: an externalReference starting with REJECT or TIMEOUT forces that outcome;
// otherwise the global mode applies (PUT /mode { "mode": "approve" | "reject" | "timeout" }).
// Confirmations are idempotent by reference, like a real partner API should be.
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const MODES = ['approve', 'reject', 'timeout'];
let mode = MODES.includes(process.env.PARTNER_MODE) ? process.env.PARTNER_MODE : 'approve';
const confirmations = new Map(); // reference → confirmation

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readJson = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve(null);
      }
    });
  });

function outcomeFor(externalRef) {
  const ref = String(externalRef ?? '').toUpperCase();
  if (ref.startsWith('REJECT')) return 'reject';
  if (ref.startsWith('TIMEOUT')) return 'timeout';
  return mode;
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && pathname === '/health') return send(res, 200, { status: 'ok', mode });

  if (req.method === 'GET' && pathname === '/confirmations') return send(res, 200, [...confirmations.values()]);

  if (req.method === 'PUT' && pathname === '/mode') {
    const body = await readJson(req);
    if (!body || !MODES.includes(body.mode)) return send(res, 400, { message: `mode must be one of ${MODES.join(', ')}` });
    mode = body.mode;
    console.log(`mode → ${mode}`);
    return send(res, 200, { mode });
  }

  if (req.method === 'POST' && pathname === '/validations') {
    const body = await readJson(req);
    const ref = String(body?.externalReference ?? body?.externalRef ?? '');
    console.log(`validate ${ref || '(no bill number)'}`);
    if (ref.toUpperCase().startsWith('INVALID')) return send(res, 422, { status: 'invalid', reason: 'unknown_bill' });
    return send(res, 200, { status: 'valid' });
  }

  if (req.method === 'POST' && pathname === '/confirmations') {
    const body = await readJson(req);
    if (!body?.reference) return send(res, 400, { message: 'reference is required' });

    const known = confirmations.get(body.reference);
    if (known) return send(res, 200, known); // idempotent retry

    const outcome = outcomeFor(body.externalReference ?? body.externalRef);
    console.log(`${body.reference} ${body.serviceCode} ${body.amount} ${body.currency} → ${outcome}`);
    if (outcome === 'timeout') return; // never answer; the caller's timeout fires
    if (outcome === 'reject') return send(res, 422, { status: 'rejected', reason: 'bill_not_payable' });

    const confirmation = { status: 'confirmed', partnerRef: `BILL-${randomUUID().slice(0, 8)}`, ...body, at: new Date().toISOString() };
    confirmations.set(body.reference, confirmation);
    return send(res, 200, confirmation);
  }

  send(res, 404, { message: 'not found' });
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`partner-mock listening on :${port} (mode: ${mode})`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
