# Profile Service

NestJS + Drizzle ORM (Postgres). Owns who holds money and where:

| Table | What |
| --- | --- |
| `profile` | `INDIVIDUAL` customer, `AGENT`, or the bank itself (`INTERNAL`); CIF number, KYC, status |
| `account_product` | Accounts a profile holds: `CURRENT` (individuals), `AGENT_FLOAT` + `COMMISSION` (agents), `INTERNAL` (bank: settlement, fee income, VAT payable, …) |
| `stock` | One currency balance inside an account; its `ledger_account` is the Formance address |

| Endpoint | Purpose |
| --- | --- |
| `POST /profiles` | Create a profile; individuals and agents get their default accounts with USD + KHR stocks (`kycVerified: true` → `ACTIVE`) |
| `GET /profiles?type=`, `GET /profiles/:id` | List; one profile with its accounts and stocks (balances mirrored) |
| `PATCH /profiles/:id/kyc`, `PATCH /profiles/:id/status` | KYC and lifecycle (`ACTIVE` requires KYC) |
| `POST /profiles/:id/accounts` | Open another account, e.g. an `INTERNAL` "Fee income" account for the bank |
| `PATCH /accounts/:id/status`, `PATCH /stocks/:id/status` | Freeze / close |
| `GET /stocks/:id`, `GET /stocks?ids=a,b` | Stocks with their account and owner (used by the payment engine) |
| `POST /stocks/:id/refresh` | Recompute a stock's mirrored balances from Formance |
| `POST /ledger-events` | Formance HTTP publisher webhook (internal) |

Swagger: http://localhost:4001/docs

## Balances

Formance is the source of truth. Each ledger event names the accounts it touched. For each affected stock (its account, or a hold account `holds:{stock number}:{order}`), the service reads Formance and stores:
- `hold_amount` = Σ the stock's hold accounts.
- `ledger_balance` = stock account + holds.
- `available_balance` = `ledger_balance − hold_amount`, a generated column.

Values are recomputed, never incremented, so duplicate events are harmless.

```bash
npm test          # vitest
npx tsc --noEmit  # typecheck
```
