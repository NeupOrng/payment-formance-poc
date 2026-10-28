# Debian (glibc): Temporal's native worker library has no musl/Alpine build.
FROM node:24-bookworm-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./

# Local development: source is bind-mounted by docker compose, hot reload via nest --watch.
FROM base AS dev
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

FROM base AS build
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
EXPOSE 3000
CMD ["node", "dist/main.js"]
