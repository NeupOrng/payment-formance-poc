# Client — Mobile Bank Console

Nuxt 4 + shadcn-vue + Tailwind CSS v4. Read-only console for the POC.

| Page | Shows |
| --- | --- |
| `/` | Profiles (individuals, agents, the bank), filter by type, search by name / CIF / phone |
| `/profiles/:id` | Each stock's balances (ledger, on hold, available — mirrored from Formance) and its payment orders with the net effect on that stock |
| `/payments/:id` | Order amounts, balance movements, the saga's Formance transactions (reserve, settle, revert, release), status history, and a link to the workflow in Temporal |
| `/services`, `/services/:code` | Service configuration: commands, SPI calls, tiers with amount rules and balance movements |

The browser only calls this app's `/api/*` routes (`server/api/`), which proxy to the services.

| Variable | Default (host) | In Docker |
| --- | --- | --- |
| `NUXT_PROFILE_SERVICE_URL` | `http://localhost:4001` | `http://profile-service:3000` |
| `NUXT_PAYMENT_SERVICE_URL` | `http://localhost:4002` | `http://payment-service:3000` |
| `NUXT_PUBLIC_TIME_ZONE` | `Asia/Phnom_Penh` | same |
| `NUXT_PUBLIC_TEMPORAL_UI_URL` | `http://localhost:8233` | same |

Runs in Docker with the stack (`task up`) at http://localhost:4000. On the host: `npm install && npm run dev`.
