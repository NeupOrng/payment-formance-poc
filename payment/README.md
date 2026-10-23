# Payment service

NestJS + Drizzle ORM (Postgres) + Formance Ledger. Owns the service catalog (services → commands → pricing tiers and balance movements), transfers, and the only connection to Formance. The full model is in [docs/05-schema.md](../docs/05-schema.md).

| Endpoint | Purpose |
| --- | --- |
| `POST /services`, `GET /services`, `GET /services/:code`, `PATCH /services/:code` | Service catalog; `GET /services/:code` includes each command's tiers and movement |
| `PUT /services/:code/commands/:command` | Command settings: status, refund/cancel window, partial refunds, net-amount formula |
| `POST /services/:code/commands/:command/pricing-tiers` | Add a pricing tier for one amount type and band; the response includes the movement's balance check |
| `PATCH /pricing-tiers/:id` | Retire a tier (`effectiveTo`); tiers are never edited in place |
| `POST /services/:code/commands/:command/movement/check` | Dry run: does this debit/credit list balance with the current tiers? |
| `PUT /services/:code/commands/:command/movement` | Save the debit/credit entries; **400 with the failing amounts if they don't balance** |
| `POST /payments` | **Perform a payment**: `{ serviceCode, amount, currency, source, destination? }`. Needs `Idempotency-Key` |
| `POST /payments/:id/refund` | Refund a payment: `{ amount? }` (default: everything not yet refunded) |
| `POST /payments/:id/cancel` | Cancel a payment (full amount, within the cancel window) |
| `POST /services/:code/:command` | Generic form: run any command, `{ currency, amount, source, destination? }` or `{ currency, originalTransferId, amount? }` |
| `POST /topups` | System flow: money from the partner bank (`@world`) into a customer account |
| `GET /transfers?customerId=&currency=&type=&status=&limit=&offset=` | History where the customer is payer or payee, newest first |
| `GET /transfers/:id` | One transfer with its calculated amount types and status events |
| `GET /transfers/:id/ledger` | The Formance postings behind it, each with its debit and credit amount type |
| `GET /customers/:id/balances`, `GET /services/:code/balances` | Live balances from Formance (service: every account its movements use) |

Swagger: http://localhost:4002/docs

## Configuring a command

Configure the three steps in this order (see `scripts/seed.ts`):

1. **Settings:** `PUT …/commands/payment` with `{}`. Refund and cancel can also set `maxAgeMinutes`, `allowPartial` and the `netAmountAdd` / `netAmountSubtract` lists.
2. **Pricing tiers.** For example, for amounts up to $40.00:
   ```json
   { "amountType": "selling_price", "currency": "USD", "minAmount": "1", "maxAmount": "4000",
     "calcType": "percent", "percentBps": 500, "includeBase": true }
   { "amountType": "fee_from_customer", "currency": "USD", "minAmount": "1", "maxAmount": "4000",
     "calcType": "percent", "percentBps": 500 }
   ```
3. **Balance movement:**
   ```json
   { "entries": [
     { "entryNo": 1, "side": "debit",  "account": "{source}",                "amountType": "selling_price" },
     { "entryNo": 2, "side": "credit", "account": "{destination}",           "amountType": "amount" },
     { "entryNo": 3, "side": "credit", "account": "platform:fees:{service}", "amountType": "fee_from_customer" }
   ] }
   ```

## How a command runs

1. Return the existing transfer if the `Idempotency-Key` was used before.
2. Load the service, the command and its movement, and make sure the service and command are active.
3. Look up the customer accounts:
   - **Payment:** the source account, plus the destination if the movement uses `{destination}`.
   - **Refund or cancel:** the original payment's source and destination.
4. **Refund or cancel only:** lock the original payment and check the time window, the partial-refund rule, and that the total reversed stays within the original amount.
5. Check the amount is inside the command's configured range. Then calculate every amount type from the tiers (`src/pricing/pricing.ts`, `bigint` only).
6. Check that Σ debits = Σ credits, pair debits with credits into postings, and write one Numscript `send` per posting (`src/movement/movement.ts`).
7. In one database transaction, insert the transfer, its amounts, its first event and an outbox row (the request plus the planned postings).
8. Post to Formance with `reference` and `Idempotency-Key` set to the transfer id:
   - **Accepted:** the transfer becomes `posted`.
   - **400** (e.g. `INSUFFICIENT_FUND`): the transfer becomes `failed`.
   - **Ledger unreachable:** the transfer stays `pending` and `OutboxWorker` retries it.

Ledger accounts:
- Customers: `users:{customerId}:{usd|khr}`.
- Specific accounts: whatever path the movement names, with `{service}` replaced and the currency appended (e.g. `platform:fees:merchant_qr:usd`).
- Outside money: `@world`.

## Develop

```bash
npm test                                         # vitest: pricing + movement (balance check, postings, Numscript)
PAYMENT_URL=http://localhost:4002 npm run seed   # example services (also: task seed)
```

Schema is in `src/db/schema.ts`. After editing it, run `task db:generate -- payment`. `drizzle/0001_pricing_tier_no_overlap.sql` is hand-written (btree_gist exclusion constraint).
