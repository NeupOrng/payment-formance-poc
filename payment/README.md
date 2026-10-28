# Payment Engine

NestJS + Drizzle ORM (Postgres) + Temporal + Formance Ledger. Holds the service configuration and runs every payment order as a saga. Model: [docs/05-schema.md](../docs/05-schema.md).

## Configuration API

| Endpoint | Purpose |
| --- | --- |
| `GET/POST /amount-types` | Amount types (data, e.g. `FEE_FROM_CUSTOMER`) |
| `GET/POST /service-groups`, `PATCH /service-groups/:id` | Groups; `INACTIVE` turns off its services |
| `GET/POST /services`, `GET/PATCH /services/:code` | Services (one currency each); `GET` returns the whole configuration |
| `PUT /services/:code/commands/:commandType` | Enable `PAYMENT`, `REFUND` or `CANCEL` |
| `POST /services/:code/commands/:commandType/tiers` | A tier: range `[min, max)`, amount rules, balance movements, validated before saving |
| `GET /tiers/:id`, `PATCH /tiers/:id`, `POST /tiers/:id/preview` | Read; deactivate (tiers are immutable); dry-run an amount |
| `GET/POST /spis`, `PATCH /spis/:code` | Providers (internal handler or external REST) |
| `POST /services/:code/commands/:commandType/spis`, `PATCH /command-spis/:id` | Attach an SPI at `PRE_PAYMENT`, `POST_PAYMENT` or `NOTIFICATION` |

## Payment API

| Endpoint | Purpose |
| --- | --- |
| `POST /payments` | `{ serviceCode, amount, payerStockId, payeeStockId, externalReference? }`; needs `Idempotency-Key`. Returns the order `PENDING` (money held, awaiting authorization), or final if it needs none / failed early |
| `POST /payments/:id/authorize` | Customer authentication → the saga processes the order |
| `POST /payments/:id/cancel` | `PENDING`: cancel (hold released). `COMPLETED`: a `CANCEL` order |
| `POST /payments/:id/refund` | A `REFUND` order, `{ amount? }` (default: the rest) |
| `GET /payments?stockId=&customerId=&status=&commandType=` | Orders, newest first; with `stockId`, each with `netForStock` |
| `GET /payments/:id` | Order with amounts, movements, ledger transactions, status history, workflow id |
| `GET /payments/:id/ledger` | The Formance transactions (RESERVE, SETTLE, REVERT, RELEASE) with postings |
| `GET /stocks/:id/ledger-balance` | A stock's balance straight from Formance |

Write calls answer **201** when the saga reached the expected point and **202** if it is still running (poll `GET /payments/:id`). Swagger: http://localhost:4002/docs · sagas: http://localhost:8233

## Code map

| Path | What |
| --- | --- |
| `src/pricing/` | Exact formula evaluator and amount rules (`computeAmounts`, `validateRules`) |
| `src/movement/` | Movement resolution and the saga's ledger plan (`resolveMovements`, `planLedger`, `toNumscript`) |
| `src/catalog/` | Configuration API and tier validation |
| `src/orders/` | `prepare` (validate, price, plan, record), ledger steps and transitions, SPI runner, API |
| `src/temporal/` | `orderSaga` workflow, activities, worker, `SagaService` (start / signal / wait) |

```bash
npm test                                                                   # vitest
PROFILE_URL=http://localhost:4001 PAYMENT_URL=http://localhost:4002 npm run seed   # also: task seed
```
