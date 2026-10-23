# Proposal: Formance Ledger as the core ledger for our mobile bank

## Executive summary

We propose using Formance Ledger (v3.2) as the single source of truth for every customer balance and money movement in the mobile bank backend. We will validate it with a 10-week proof of concept (POC) before committing.

- **What it replaces:** hand-built balance columns and transfer logic in our application database.
- **What we get:** double-entry transactions that apply in full or not at all, a history that cannot be edited, checks for available funds, holds, and idempotent APIs — without building and auditing our own ledger engine.
- **What stays with us:** KYC, limits, pricing, card and bank-rail integrations, statements, and the general ledger (GL).
- **Decisions needed now:** approve the POC, choose Formance Cloud or self-hosted for the POC, and request an Enterprise (EE) trial if we want to evaluate Wallets, Payments and Reconciliation.

## Background and goals

A mobile bank must never lose, duplicate or invent money, even when requests are retried, run at the same time, or partly fail. Getting this right in-house typically means building double-entry bookkeeping, locking, idempotency, audit trails and reconciliation ourselves.

**Goals**

1. Every money movement is a balanced, atomic ledger transaction.
2. Balances are calculated from the ledger, never written directly.
3. Retries from the mobile app or partner webhooks never create duplicate transactions.
4. Holds (card authorizations, pending withdrawals) are first-class and reversible.
5. Finance can reconcile ledger balances against partner bank statements every day.

**Non-goals for the POC**

- Production launch, real customer money or regulatory sign-off
- Interest accrual, loans and statements
- Migrating existing customer data

## Why Formance

Formance is a product ledger: it controls balances and money movements in real time inside the application, while a general ledger reports the company's financial position afterwards ([Formance docs](https://docs.formance.com/v3.2/modules/ledger?deployment=cloud&license=ee)). That is exactly the layer a mobile bank backend needs.

| Capability | Why it matters for a mobile bank |
| --- | --- |
| Double-entry postings, all or nothing | No half-completed transfers; total balances always add up |
| Append-only history | Corrections are new transactions, which gives auditors a full trail |
| Balances derived from postings | No balance column that can drift from the history |
| Numscript | Splits, fees, holds and overdraft limits written as reviewable scripts |
| Idempotency and unique references | Safe retries from mobile clients and partner webhooks |
| Bi-temporality | Back-dated entries (e.g. late bank confirmations) without rewriting history |
| Buckets and multiple ledgers | Separate data per legal entity or country |
| Event publishing | Feed analytics and our own read models |
| EE modules: Wallets, Payments, Reconciliation, Webhooks | Ready-made holds, bank connectors and statement matching we would otherwise build |

**Build vs. buy:** building our own ledger is feasible, but the hard parts — handling concurrent requests correctly, idempotency, and verifying integrity — are what Formance already provides. The POC tests whether it does so at our volumes.
