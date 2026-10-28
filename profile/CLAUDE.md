# Profile Service

See the root `CLAUDE.md` for stack conventions and domain rules.

- Owns `profile`, `account_product`, `stock`. The schema follows the planned *Profile Service* tables; keep its constraints (`chk_active_needs_kyc`, `chk_account_owner`, `uq_stock_currency`, owner type pinned by `fk_account_owner`).
- **Stock balance columns are a read model.** Only `LedgerSyncService` writes them, recomputing absolute values from Formance (`LedgerReader`, read-only). Never increment them, and never let other code write them.
- **`stock.ledger_account`** is `{profile type}:{CIF}:{product type}:{stock number}` (lower case, ids only), built by `ledgerAccountFor()`. The payment engine posts to whatever this column says, so never change the format for existing rows.
- **Hold accounts** are `holds:{stock number}:{order id}`. The payment engine creates them; this service sums them for `hold_amount`.
- **The payment engine depends on** `GET /stocks?ids=` and `GET /stocks/:id` (with `account` and `profile`). Keep those shapes stable.
