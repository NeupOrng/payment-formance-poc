# Target architecture

Only the Ledger Service writes to Formance. The mobile app, partner webhooks and back-office tools all go through our API, which records the business intent in Postgres first and then posts it to the ledger.

```mermaid
flowchart LR
    APP["Mobile app"] --> GW["API gateway<br/>auth, rate limits"]
    GW --> CORE["Banking API<br/>KYC, limits, pricing"]
    PARTNER["Partner bank /<br/>card processor"] -- webhooks --> CORE
    CORE --> DB[("Postgres<br/>transfers, holds, outbox")]
    CORE --> LS["Ledger Service<br/>Numscript templates"]
    LS -- "idempotency key + reference" --> FL["Formance Ledger<br/>balances + history"]
    LS --> DB
    FL -- events --> BUS["Event bus"]
    BUS --> RM["Read models<br/>history, notifications"]
    BUS --> DWH["Data warehouse"]
    RECON["Reconciliation job"] --> FL
    RECON --> PARTNER
    DWH --> GL["General ledger / ERP"]
```

| Component | Owns | Does not own |
| --- | --- | --- |
| Banking API | Customer rules: KYC, limits, fees, card controls | Balances |
| Ledger Service | Numscript templates, posting, retries, reversals | Business decisions |
| Postgres | Transfer intent and state, holds, outbox, recon results | Money balances |
| Formance Ledger | Balances, postings, immutable history | Customer data (only IDs in metadata) |
| Reconciliation job | Daily match of ledger vs. partner statements | Fixing breaks automatically |
