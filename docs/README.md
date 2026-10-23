# Formance Ledger POC — documentation

Proposal and design for using [Formance Ledger v3.2](https://docs.formance.com/v3.2/modules/ledger?deployment=cloud&license=ee) as the core ledger for our mobile bank backend.

Source: the shared proposal doc (as of 2026-10-06), https://claude.ai/code/artifact/72bc00b1-1797-4b84-91cb-ba98081c229f

| Doc | What it covers |
| --- | --- |
| [01-proposal.md](01-proposal.md) | Executive summary, background and goals, why Formance |
| [02-architecture.md](02-architecture.md) | Target architecture and component responsibilities |
| [03-chart-of-accounts.md](03-chart-of-accounts.md) | Ledger account naming and rules |
| [04-transaction-flows.md](04-transaction-flows.md) | Posting pattern, top-up, P2P, card, withdrawal, corrections (with Numscript) |
| [05-schema.md](05-schema.md) | Postgres schema: customers, accounts, services, amount types, pricing tiers, balanced movements, transfers |
| [06-implementation-plan.md](06-implementation-plan.md) | Phases, success criteria, risks, open decisions |

## Current design decisions

These are the newest decisions. Where an older section disagrees, these win.

- **Two accounts per customer:** each customer has exactly two accounts, one USD (`USD/2`) and one KHR (`KHR/2`). Their ledger addresses are `users:{customer_id}:usd` and `users:{customer_id}:khr`.
- **Every customer transaction runs through a service:** each service has 2–3 commands (`payment`, `refund`, `cancel`). The request carries only amount, currency, source and destination.
  - Each command prices 16 amount types (selling price, fees, commissions, VAT, …) with its own tiers.
  - Each command moves money with a debit/credit movement that must balance before it can be saved.
  - See [05-schema.md](05-schema.md#service-configuration).
- **Cards are out of scope for now:** there are no card tables in the schema.
- **No FX yet:** both sides of a transfer must be in the same currency.

## Known gaps to reconcile

- [03-chart-of-accounts.md](03-chart-of-accounts.md) and [04-transaction-flows.md](04-transaction-flows.md) were written before the two-account and service model. They still use `users:{id}:main`, savings and hold accounts, and card flows.
- The Numscript is a proposal that hasn't been run. Check it against the v3.2 Numscript reference before you build on it.
