type PgError = { code?: string; constraint?: string };

export function pgError(err: unknown): PgError | undefined {
  const candidate = (err as { cause?: unknown })?.cause ?? err;
  if (candidate && typeof candidate === 'object' && 'code' in candidate) return candidate as PgError;
  return undefined;
}
