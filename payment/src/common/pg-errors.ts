type PgError = { code?: string; constraint?: string };

/** Drizzle wraps driver errors; returns the underlying Postgres error if there is one. */
export function pgError(err: unknown): PgError | undefined {
  const candidate = (err as { cause?: unknown })?.cause ?? err;
  if (candidate && typeof candidate === 'object' && 'code' in candidate) {
    return candidate as PgError;
  }
  return undefined;
}

export function isUniqueViolation(err: unknown, constraint?: string) {
  const e = pgError(err);
  return e?.code === '23505' && (!constraint || e.constraint === constraint);
}

export function isExclusionViolation(err: unknown) {
  return pgError(err)?.code === '23P01';
}
