# Client (Nuxt 4)

See the root `CLAUDE.md` for domain rules.

- **Nuxt 4 layout:** app code is in `app/` (pages, layouts, components, utils), proxy routes are in `server/`, and types shared by both are in `shared/types/bank.ts` (auto-imported).
- **The browser never calls the services directly.** Add a route under `server/api/` that uses `backend('profile' | 'payment', path, query)` from `server/utils/backend.ts` (it uses `ofetch`, not Nitro's typed `$fetch`).
- **Pages:**
  - `/`: profiles.
  - `/profiles/:id`: stocks with mirrored balances, and payment orders per stock.
  - `/payments/:id`: amounts, movements, saga ledger transactions, history, and a Temporal link.
  - `/services` and `/services/:code`: read-only configuration.
- **Amounts are decimal strings** ("21.00"). Format them only with `formatMoney()` (string-based, no floats) and dates only with `formatDateTime()` (fixed time zone, so SSR and hydration match). Use `humanize()` for codes and `StatusBadge` for any status.
- **UI components are shadcn-vue** (`app/components/ui/`, generated). Add more with `npx shadcn-vue@latest add`.
- **TypeScript is pinned to 5.9** because `vue-tsc` doesn't support TypeScript 7 yet.
- **The console is read-only.** Money-moving actions go through the payment engine API with an `Idempotency-Key`.
