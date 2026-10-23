# Client — Mobile Bank Console

Nuxt 4 + shadcn-vue + Tailwind CSS v4. Read-only console for viewing each customer's assets and transaction history.

| Page | Shows |
| --- | --- |
| `/` | Customers, with search by name, phone or ID |
| `/customers/:id` | USD and KHR balances (live from Formance), and transaction history filtered by currency, type and status, 20 per page |
| `/transfers/:id` | One transfer: the actual ledger postings and the net effect on the customer, details, and status history |

## How it talks to the backend

The browser only calls this app's own `/api/*` routes (`server/api/`). Those Nitro routes proxy to the services through `server/utils/backend.ts`, so there are no CORS settings and the service URLs never reach the browser.

| Variable | Default (host) | In Docker |
| --- | --- | --- |
| `NUXT_CUSTOMER_SERVICE_URL` | `http://localhost:4001` | `http://customer-service:3000` |
| `NUXT_PAYMENT_SERVICE_URL` | `http://localhost:4002` | `http://payment-service:3000` |
| `NUXT_PUBLIC_TIME_ZONE` | `Asia/Phnom_Penh` | same |

## Develop

It runs in Docker with the rest of the stack (`task up`), at http://localhost:4000 with hot reload. To run it on the host instead (with the services up in Docker):

```bash
npm install
npm run dev
```

Add shadcn-vue components with `npx shadcn-vue@latest add <name>`; they're generated into `app/components/ui/`. Run `npm run typecheck` (`nuxi typecheck`) to type-check.
