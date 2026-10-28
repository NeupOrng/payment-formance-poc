/**
 * Exact arithmetic for amount rules. Values are fractions of big integers, so percentages and
 * divisions never lose precision; rounding happens once, at the end of each rule.
 */
export type Fraction = { n: bigint; d: bigint };

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));

export function frac(n: bigint, d = 1n): Fraction {
  if (d === 0n) throw new Error('division by zero');
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}

/** "5.5" → 11/2 */
export function fromDecimal(value: string): Fraction {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new Error(`not a number: ${value}`);
  const decimals = m[3] ?? '';
  const n = BigInt(m[2] + decimals) * (m[1] ? -1n : 1n);
  return frac(n, 10n ** BigInt(decimals.length));
}

export const add = (a: Fraction, b: Fraction) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Fraction, b: Fraction) => frac(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Fraction, b: Fraction) => frac(a.n * b.n, a.d * b.d);
export const div = (a: Fraction, b: Fraction) => frac(a.n * b.d, a.d * b.n);
export const cmp = (a: Fraction, b: Fraction) => {
  const x = a.n * b.d - b.n * a.d;
  return x < 0n ? -1 : x > 0n ? 1 : 0;
};

/** Rounds half up (away from zero at .5) to 2 decimals and returns minor units: 21.505 → 2151n. */
export function toMinorRounded(value: Fraction): bigint {
  const scaled = value.n * 100n;
  const q = scaled / value.d;
  const r = scaled % value.d;
  if (r === 0n) return q;
  const twice = (r < 0n ? -r : r) * 2n;
  if (twice >= value.d) return value.n < 0n ? q - 1n : q + 1n;
  return q;
}

export const fromMinor = (minor: bigint) => frac(minor, 100n);

// ------------------------------------------------------------------------- formula expressions

type Node =
  | { kind: 'num'; value: Fraction }
  | { kind: 'ref'; code: string }
  | { kind: 'neg'; arg: Node }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/'; left: Node; right: Node };

/**
 * Parses a formula such as `FEE + AMOUNT` or `(AMOUNT - DISCOUNT) * 1.1`: amount-type codes,
 * numbers, + - * / and parentheses. Nothing else is accepted, so a formula can never run code.
 */
export function parseFormula(source: string): Node {
  const tokens = source.match(/\s*([A-Z][A-Z0-9_]*|\d+(?:\.\d+)?|[-+*/()]|\S)/g)?.map((t) => t.trim()) ?? [];
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  const primary = (): Node => {
    const t = next();
    if (t === undefined) throw new Error('formula ends unexpectedly');
    if (t === '(') {
      const inner = sum();
      if (next() !== ')') throw new Error('missing )');
      return inner;
    }
    if (t === '-') return { kind: 'neg', arg: primary() };
    if (/^\d/.test(t)) return { kind: 'num', value: fromDecimal(t) };
    if (/^[A-Z]/.test(t)) return { kind: 'ref', code: t };
    throw new Error(`unexpected "${t}" in formula`);
  };
  const product = (): Node => {
    let node = primary();
    while (peek() === '*' || peek() === '/') node = { kind: 'bin', op: next() as '*' | '/', left: node, right: primary() };
    return node;
  };
  const sum = (): Node => {
    let node = product();
    while (peek() === '+' || peek() === '-') node = { kind: 'bin', op: next() as '+' | '-', left: node, right: product() };
    return node;
  };

  const ast = sum();
  if (pos !== tokens.length) throw new Error(`unexpected "${tokens[pos]}" in formula`);
  return ast;
}

export function formulaRefs(node: Node, into = new Set<string>()): Set<string> {
  if (node.kind === 'ref') into.add(node.code);
  if (node.kind === 'neg') formulaRefs(node.arg, into);
  if (node.kind === 'bin') {
    formulaRefs(node.left, into);
    formulaRefs(node.right, into);
  }
  return into;
}

export function evaluate(node: Node, values: ReadonlyMap<string, Fraction>): Fraction {
  switch (node.kind) {
    case 'num':
      return node.value;
    case 'ref': {
      const v = values.get(node.code);
      if (!v) throw new Error(`${node.code} has no value yet`);
      return v;
    }
    case 'neg':
      return sub(frac(0n), evaluate(node.arg, values));
    case 'bin': {
      const l = evaluate(node.left, values);
      const r = evaluate(node.right, values);
      return node.op === '+' ? add(l, r) : node.op === '-' ? sub(l, r) : node.op === '*' ? mul(l, r) : div(l, r);
    }
  }
}
