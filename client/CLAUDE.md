# Client (Nuxt 4)

See the root `CLAUDE.md` for domain rules.

- Nuxt 4 layout: app code is in `app/` (pages, layouts, components, utils), proxy routes are in `server/`, and types shared by both are in `shared/types/bank.ts` (auto-imported). The `@/` alias points to `app/`.
- **The browser never calls the services directly.** Add a route under `server/api/` that uses `backend('customer' | 'payment', path, query)` from `server/utils/backend.ts`. It uses `ofetch`, not Nitro's `$fetch`, whose typed internal routes break on external URLs.
- **Amounts are strings of digits in the smallest unit.** Format them only with `formatMoney()` in `app/utils/format.ts` (BigInt, no floats). Both USD/2 and KHR/2 have 2 decimals.
- **Format dates only with `formatDateTime()`,** which uses `runtimeConfig.public.timeZone`, so server-rendered and hydrated HTML match.
- **UI components are shadcn-vue** (`app/components/ui/`, generated, auto-imported without a prefix). Prefer adding components with `npx shadcn-vue@latest add` over hand-writing them. Use `StatusBadge` for any status.
- **TypeScript is pinned to 5.9** because `vue-tsc` doesn't support TypeScript 7 yet.
- **The console is read-only for now.** Money-moving actions should go through the payment service API with an `Idempotency-Key` if they're added later.
