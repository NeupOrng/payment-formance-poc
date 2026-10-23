# Customer service

See the root `CLAUDE.md` for stack conventions and domain rules.

- Owns `customers` and `accounts` only. Never add balance columns: balances live in Formance and are read by the payment service.
- `POST /customers` must keep creating exactly one USD and one KHR account in the same DB transaction. `accounts (customer_id, currency)` is unique.
- An account's `ledger_address` (`users:{customerId}:{usd|khr}`) is built by `ledgerAddress()` in `customers.service.ts`. The payment service posts to whatever this column says, so never change the format for existing rows.
- The payment service depends on these routes: `GET /customers/:id/accounts/:currency` (the response includes `customerStatus` and `kycStatus`) and `GET /customers/:id/accounts`. Keep their response shapes stable.
