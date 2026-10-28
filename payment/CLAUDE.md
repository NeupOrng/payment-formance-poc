# Payment Engine

See the root `CLAUDE.md` for stack conventions and domain rules, and `docs/05-schema.md` for the model.

- **Configuration is the product.**
  - `CatalogService.createTier` validates a tier before saving it:
    - Rule order and references (`validateRules`).
    - Movements use priced amount types.
    - `SPECIFIC` stocks exist in the service currency.
    - The rules price cleanly at the range edges.
  - Keep that validation in front of every new configuration path.
- **Pricing** (`src/pricing/`): `FIXED` = fixed + base × percentage / 100; `FORMULA` = codes, numbers, `+ − × ÷ ( )` only (no `eval`). The maths uses exact fractions, clamps to min / max, rounds half up to 2 decimals, and later rules see the rounded values.
- **Saga** (`src/temporal/workflows.ts`), run by `orderSaga`:
  1. `prepareOrder`.
  2. `RESERVE`.
  3. Wait for the `authorize` / `cancel` signal, with a timeout.
  4. `PROCESSING`.
  5. `PRE_PAYMENT` SPIs.
  6. `SETTLE`.
  7. `POST_PAYMENT` SPIs.
  8. `COMPLETED`.
  9. `NOTIFICATION` (best effort).

  The state is exposed through the `state` query, and the API polls it to decide between 201 and 202.
- **Compensation:**
  - A ledger refusal at `RESERVE` fails the order with `INSUFFICIENT_FUNDS`.
  - A cancellation, an authorization timeout, or a `PRE_PAYMENT` failure triggers `RELEASE`.
  - A `POST_PAYMENT` failure triggers `REVERT` then `RELEASE`.
  - A refused compensation throws `CompensationFailed`, so it shows in the Temporal UI.
- **Idempotency everywhere:**
  - Workflow id is `order-{payer profile}-{Idempotency-Key}`, with `REJECT_DUPLICATE` + `USE_EXISTING`.
  - `prepare` returns the existing order for a known key.
  - Ledger references are `{orderId}:{step}`.
  - `transition()` ignores illegal or repeated moves.
- **Activities:**
  - `prepareOrder` turns 4xx `HttpException`s into a non-retryable `ValidationError`, which the API maps back to the same status.
  - SPI rejections (4xx, or an internal handler saying no) are non-retryable `SpiRejected`. Outages retry up to the SPI's `max_retries`.
- **Internal SPI handlers** live in `SpiRunnerService.handlers`: `sanctions-screening`, `push-notification`, `noop`. External SPIs support `REST` with `NONE` / `API_KEY` / `BASIC` auth for now.
- **Ledger plan** (`planLedger`):
  - Only customer-facing stocks (payer / payee whose product isn't `INTERNAL`) are reserved.
  - `INTERNAL` sources may overdraft.
  - `REVERT` uses Formance's revert API (no script).
- **Seed and tests depend on exact numbers:** `scripts/seed.ts` (CASH_IN, P2P, EDC_BILL_USD, MERCHANT_QR_USD, MOBILE_TOPUP_USD) and `architecture/scripts/smoke.mjs`.
