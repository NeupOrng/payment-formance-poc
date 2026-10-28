/** Formance amounts are integers in the smallest unit; the stock columns are NUMERIC(20,2). */
export function minorToDecimal(minor: bigint | number): string {
  const value = BigInt(minor);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}
