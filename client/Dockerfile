FROM node:24-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
# `nuxt prepare` (postinstall) needs the source; it runs again on dev/build anyway.
RUN npm ci --ignore-scripts

# Local development: source is bind-mounted by docker compose, hot reload via nuxt dev.
FROM base AS dev
COPY . .
EXPOSE 3000
CMD ["npx", "nuxt", "dev", "--host", "0.0.0.0", "--port", "3000"]

FROM base AS build
COPY . .
RUN npx nuxt build

FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build /app/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
