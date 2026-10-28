import { holdAccount, planLedger, resolveMovements, toNumscript, type MovementConfig, type StockInfo } from './movement.js';

const payer = 'stock-payer';
const payee = 'stock-payee';
const fees = 'stock-fees';
const stocks = new Map<string, StockInfo>([
  [payer, { id: payer, stockNumber: '000000000001', ledgerAccount: 'individual:cif1:current:000000000001', productType: 'CURRENT' }],
  [payee, { id: payee, stockNumber: '000000000002', ledgerAccount: 'individual:cif2:current:000000000002', productType: 'CURRENT' }],
  [fees, { id: fees, stockNumber: '000000000003', ledgerAccount: 'internal:cif3:internal:000000000003', productType: 'INTERNAL' }],
]);

// The spec example: payer → payee AMOUNT, payer → fee account FEE_FROM_CUSTOMER
const config: MovementConfig[] = [
  { movementSequence: 2, amountType: 'FEE_FROM_CUSTOMER', fromStockRole: 'PAYER', fromStockId: null, toStockRole: 'SPECIFIC', toStockId: fees },
  { movementSequence: 1, amountType: 'AMOUNT', fromStockRole: 'PAYER', fromStockId: null, toStockRole: 'PAYEE', toStockId: null },
];
const amounts = new Map([['AMOUNT', 2_000n], ['FEE_FROM_CUSTOMER', 100n]]);

describe('resolveMovements', () => {
  it('maps roles to the order stocks, in sequence order', () => {
    expect(resolveMovements(config, amounts, { payer, payee })).toEqual([
      { movementSequence: 1, amountType: 'AMOUNT', amount: 2_000n, fromStockId: payer, toStockId: payee },
      { movementSequence: 2, amountType: 'FEE_FROM_CUSTOMER', amount: 100n, fromStockId: payer, toStockId: fees },
    ]);
  });

  it('skips amount types that came out 0 or have no rule', () => {
    expect(resolveMovements(config, new Map([['AMOUNT', 500n]]), { payer, payee })).toHaveLength(1);
  });

  it('refuses a movement from a stock to itself', () => {
    expect(() => resolveMovements(config, amounts, { payer, payee: payer })).toThrow(/to itself/);
  });
});

describe('planLedger', () => {
  const movements = resolveMovements(config, amounts, { payer, payee });

  it('reserves what the payer pays, settles from the hold, and plans release and revert', () => {
    const plan = planLedger(movements, stocks, new Set([payer, payee]), 'order-1', 'USD/2');
    expect(plan.map((t) => t.step)).toEqual(['RESERVE', 'RELEASE', 'SETTLE', 'REVERT']);
    const [reserve, release, settle, revert] = plan;
    const hold = holdAccount('000000000001', 'order-1');

    expect(reserve.postings).toMatchObject([{ source: 'individual:cif1:current:000000000001', destination: hold, amount: '21.00' }]);
    expect(release.postings).toMatchObject([{ source: hold, destination: 'individual:cif1:current:000000000001', amount: '21.00' }]);
    expect(settle.postings.map((p) => [p.source, p.destination, p.amount, p.amountType])).toEqual([
      [hold, 'individual:cif2:current:000000000002', '20.00', 'AMOUNT'],
      [hold, 'internal:cif3:internal:000000000003', '1.00', 'FEE_FROM_CUSTOMER'],
    ]);
    expect(revert.numscript).toBeNull();
    expect(revert.postings[0]).toMatchObject({ source: 'internal:cif3:internal:000000000003', destination: hold });
  });

  it('lets INTERNAL bank stocks go negative but never holds them', () => {
    const cashIn = resolveMovements(
      [{ movementSequence: 1, amountType: 'AMOUNT', fromStockRole: 'PAYER', fromStockId: null, toStockRole: 'PAYEE', toStockId: null }],
      new Map([['AMOUNT', 5_000n]]),
      { payer: fees, payee },
    );
    const plan = planLedger(cashIn, stocks, new Set([payee]), 'order-2', 'USD/2');
    expect(plan.map((t) => t.step)).toEqual(['SETTLE', 'REVERT']);
    expect(plan[0].numscript).toContain('source = @internal:cif3:internal:000000000003 allowing unbounded overdraft');
  });
});

describe('toNumscript', () => {
  it('writes one send per posting in minor units', () => {
    expect(toNumscript([{ source: 'a', destination: 'b', amount: '21.50', fromStockId: null, toStockId: null, amountType: null, movementSequence: null }], 'KHR/2')).toBe(
      'send [KHR/2 2150] (\n  source = @a\n  destination = @b\n)\n',
    );
  });
});
