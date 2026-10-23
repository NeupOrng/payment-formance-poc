# Customer service

NestJS + Drizzle ORM (Postgres). Owns customers and their two accounts, one USD (`USD/2`) and one KHR (`KHR/2`). It stores each account's Formance ledger address but **never balances**: the payment service reads those from Formance.

| Endpoint | Purpose |
| --- | --- |
| `POST /customers` | Create a customer; its USD and KHR accounts are created in the same DB transaction |
| `GET /customers`, `GET /customers/:id` | List / get (with accounts) |
| `PATCH /customers/:id/kyc`, `PATCH /customers/:id/status` | KYC and lifecycle status |
| `GET /customers/:id/accounts` | Both accounts |
| `GET /customers/:id/accounts/:currency` | One account plus the customer's status (used by the payment service) |
| `GET /accounts/:id`, `PATCH /accounts/:id/status` | Get / freeze / close an account |
| `GET /health` | Liveness + DB check |

Swagger: http://localhost:4001/docs

## Develop

Run it through the root `Taskfile.yml` (`task up`). Schema is in `src/db/schema.ts`; after editing it run `task db:generate -- customer` and commit the new file in `drizzle/`. Migrations apply on start-up.

```bash
npm test          # vitest
npx tsc --noEmit  # typecheck
```
