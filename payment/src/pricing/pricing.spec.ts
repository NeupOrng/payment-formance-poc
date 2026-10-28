import { evaluate, frac, fromDecimal, parseFormula, toMinorRounded } from './expression.js';
import { computeAmounts, validateRules, type AmountRule } from './pricing.js';

const rule = (o: Partial<AmountRule> & Pick<AmountRule, 'amountType' | 'calcSequence'>): AmountRule => ({
  calcMethod: 'FIXED',
  baseAmountType: null,
  fixedValue: null,
  percentage: null,
  formulaExpression: null,
  minValue: null,
  maxValue: null,
  ...o,
});

describe('formula expressions', () => {
  it('evaluates codes, numbers, precedence and parentheses exactly', () => {
    const values = new Map([['AMOUNT', fromDecimal('20')], ['FEE', fromDecimal('1')]]);
    expect(evaluate(parseFormula('FEE + AMOUNT'), values)).toEqual(frac(21n));
    expect(evaluate(parseFormula('(AMOUNT - FEE) * 1.1'), values)).toEqual(fromDecimal('20.9'));
    expect(evaluate(parseFormula('AMOUNT / 3'), values)).toEqual(frac(20n, 3n));
    expect(evaluate(parseFormula('-FEE + 2'), values)).toEqual(frac(1n));
  });

  it('rejects anything that is not codes, numbers or + - * / ( )', () => {
    expect(() => parseFormula('AMOUNT + process.exit()')).toThrow();
    expect(() => parseFormula('AMOUNT +')).toThrow(/ends unexpectedly/);
    expect(() => parseFormula('(AMOUNT')).toThrow(/missing \)/);
  });

  it('rounds half up to 2 decimals', () => {
    expect(toMinorRounded(fromDecimal('2.505'))).toBe(251n);
    expect(toMinorRounded(fromDecimal('2.504'))).toBe(250n);
    expect(toMinorRounded(frac(20n, 3n))).toBe(667n);
  });
});

describe('computeAmounts', () => {
  // The spec example: ≤ $40, FEE = 5% of AMOUNT, SELLING_PRICE = FEE + AMOUNT
  const example = [
    rule({ amountType: 'FEE_FROM_CUSTOMER', calcSequence: 1, baseAmountType: 'AMOUNT', percentage: '5' }),
    rule({ amountType: 'SELLING_PRICE', calcSequence: 2, calcMethod: 'FORMULA', formulaExpression: 'FEE_FROM_CUSTOMER + AMOUNT' }),
  ];

  it('runs rules in calc_sequence order and uses earlier results', () => {
    const v = computeAmounts(2_000n, [...example].reverse());
    expect(v.get('FEE_FROM_CUSTOMER')).toBe(100n);
    expect(v.get('SELLING_PRICE')).toBe(2_100n);
  });

  it('adds a fixed value to a percentage and clamps to min / max', () => {
    const r = [rule({ amountType: 'FEE', calcSequence: 1, fixedValue: '0.10', baseAmountType: 'AMOUNT', percentage: '1', minValue: '0.25', maxValue: '5.00' })];
    expect(computeAmounts(500n, r).get('FEE')).toBe(25n); // 0.10 + 0.05 → min 0.25
    expect(computeAmounts(10_000n, r).get('FEE')).toBe(110n); // 0.10 + 1.00
    expect(computeAmounts(10_000_000n, r).get('FEE')).toBe(500n); // capped
  });

  it('later rules use the rounded value of earlier ones', () => {
    const r = [
      rule({ amountType: 'FEE', calcSequence: 1, baseAmountType: 'AMOUNT', percentage: '0.25' }),
      rule({ amountType: 'VAT', calcSequence: 2, baseAmountType: 'FEE', percentage: '10' }),
    ];
    const v = computeAmounts(10_002n, r); // fee 25.005 cents → 25; VAT 10% of 0.25 = 2.5 → 3
    expect(v.get('FEE')).toBe(25n);
    expect(v.get('VAT')).toBe(3n);
  });

  it('refuses a negative result', () => {
    expect(() =>
      computeAmounts(100n, [rule({ amountType: 'NET_AMOUNT', calcSequence: 1, calcMethod: 'FORMULA', formulaExpression: 'AMOUNT - 5' })]),
    ).toThrow(/negative/);
  });
});

describe('validateRules', () => {
  const known = new Set(['AMOUNT', 'FEE', 'SELLING_PRICE', 'VAT']);

  it('accepts rules that only use AMOUNT and earlier results', () => {
    expect(
      validateRules(
        [
          rule({ amountType: 'FEE', calcSequence: 1, baseAmountType: 'AMOUNT', percentage: '5' }),
          rule({ amountType: 'SELLING_PRICE', calcSequence: 2, calcMethod: 'FORMULA', formulaExpression: 'FEE + AMOUNT' }),
        ],
        known,
      ),
    ).toEqual([]);
  });

  it('reports forward references, unknown types and bad formulas', () => {
    const problems = validateRules(
      [
        rule({ amountType: 'SELLING_PRICE', calcSequence: 1, calcMethod: 'FORMULA', formulaExpression: 'FEE + AMOUNT' }),
        rule({ amountType: 'FEE', calcSequence: 2, baseAmountType: 'AMOUNT', percentage: '5' }),
        rule({ amountType: 'TIP', calcSequence: 3, fixedValue: '1' }),
        rule({ amountType: 'VAT', calcSequence: 4, calcMethod: 'FORMULA', formulaExpression: 'FEE +' }),
      ],
      known,
    );
    expect(problems.join('\n')).toMatch(/uses FEE, which is not AMOUNT or calculated earlier/);
    expect(problems.join('\n')).toMatch(/TIP.*unknown amount type/);
    expect(problems.join('\n')).toMatch(/VAT.*ends unexpectedly/);
  });
});
