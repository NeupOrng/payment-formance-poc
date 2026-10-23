# Payment service

See the root `CLAUDE.md` for stack conventions and domain rules, and `docs/05-schema.md` for the model.

- **Public payment API:** `POST /payments` (body `serviceCode`, `amount`, `currency`, `source`, `destination?`), `POST /payments/:id/refund` and `POST /payments/:id/cancel` are thin wrappers over `executeCommand()` (`pay()`, `reversePayment()` in `transfers.service.ts`). Keep all rules in `executeCommand()`; don't duplicate them in the wrappers.
- **Callers send only** service + command, `amount`, `currency`, `source` (payer customer) and `destination` (payee customer, only if the movement uses `{destination}`). Refund and cancel send `originalTransferId` and reuse the original's parties. Never add other amount inputs to the request; new values belong in pricing tiers.
- **16 amount types** (`AMOUNT_TYPES` in `src/db/schema.ts`):
  - `amount` comes from the request.
  - `net_amount` comes from the command's `net_amount_add` / `net_amount_subtract`.
  - Every other type comes from `service_pricing_tiers`, calculated by `src/pricing/pricing.ts` (`ruleValue`, `computeAmounts`). Rules based on `amount` run first, then rules based on another type, one level deep. `include_base` gives "selling price = amount + x%".
- **Balance movement:** `service_movement_entries` lists debit and credit entries. `src/movement/movement.ts`:
  - `checkBalance` samples amounts inside the command's band range, per currency, and must find Σ debits = Σ credits. It runs before a movement is saved, in `POST …/movement/check`, and in every pricing-tier response.
  - `planPostings` pairs debits with credits in entry order, skips self-pairs and zero values, and throws if the movement is unbalanced. It's called again before every posting.
  - `toNumscript` writes one `send` per posting, with `allowing unbounded overdraft` only on entries that set `allow_overdraft`.
- **Ledger postings carry amount types:** the planned postings, with their `debitType` and `creditType`, are stored in `ledger_outbox.postings`. `GET /transfers/:id/ledger` matches them to Formance's postings by index.
- **Refunds and cancels are priced with their own command's tiers.** They don't copy the original's amounts. `reversalAmount()` locks the original `FOR UPDATE` and checks the window, partial-refund rule and total.
- **Ledger errors:**
  - A 400 marks the transfer `failed`.
  - A 409 `CONFLICT` means the posting already exists; the poster looks it up by reference and marks the transfer `posted`.
  - Anything else is retried with backoff, until `dead` after 10 attempts.
- **Example configuration** is in `scripts/seed.ts`: EDC_BILL, MOBILE_TOPUP, MERCHANT_QR (the spec example) and P2P_TRANSFER. `architecture/scripts/smoke.mjs` depends on those exact numbers.
