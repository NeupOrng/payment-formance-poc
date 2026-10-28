# Formance Ledger POC — documentation

Proposal and design for using [Formance Ledger v3.2](https://docs.formance.com/v3.2/modules/ledger?deployment=cloud&license=ee) as the core ledger for our mobile bank backend.

Source: the shared proposal doc (as of 2026-10-06), https://claude.ai/code/artifact/72bc00b1-1797-4b84-91cb-ba98081c229f

| Doc | What it covers |
| --- | --- |
| [01-proposal.md](01-proposal.md) | Executive summary, background and goals, why Formance |
| [02-architecture.md](02-architecture.md) | Target architecture and component responsibilities |
| [03-chart-of-accounts.md](03-chart-of-accounts.md) | Ledger account naming and rules |
| [04-transaction-flows.md](04-transaction-flows.md) | Posting pattern, top-up, P2P, card, withdrawal, corrections (with Numscript) |
| [05-schema.md](05-schema.md) | The implemented model: profiles and stocks, service configuration, payment orders, the Temporal saga |
| [06-implementation-plan.md](06-implementation-plan.md) | Phases, success criteria, risks, open decisions |

## Current design decisions

These are the newest decisions. Where an older doc disagrees, these win.

- **Schema:** follows the planned *Payment Engine & Profile Schema* (see [05-schema.md](05-schema.md)).
  - **Profile Service:** profile → account_product → stock, one stock per currency.
  - **Payment Engine:** service groups → services (one currency each) → commands → tiers, with amount rules and from → to balance movements, plus SPIs.
- **Every payment order is a Temporal saga:** reserve → authorize → PRE_PAYMENT SPIs → settle → POST_PAYMENT SPIs → complete → notify. Failures are compensated with new ledger transactions (revert, release).
- **Formance is the source of truth for money.** The stock balance columns mirror it from ledger events.
- **Cards are out of scope for now.**

## Known gaps

- [02-architecture.md](02-architecture.md), [03-chart-of-accounts.md](03-chart-of-accounts.md) and [04-transaction-flows.md](04-transaction-flows.md) are from the original proposal (customer service, account paths, cards). [05-schema.md](05-schema.md) supersedes them.
- Not built yet:
  - Load testing.
  - Reconciliation against partner statements.
  - A real customer authentication factor (PIN / OTP).
  - External SPI protocols other than REST.
  - OAuth2 / mTLS for SPIs.
