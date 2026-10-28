import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  // Only needed for `drizzle-kit studio` / `push`; `task db:studio -- profile` builds it from architecture/.env.
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
