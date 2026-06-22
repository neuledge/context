FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY . .

# pnpm deploy assembles a self-contained folder with prod deps and the
# already-built better-sqlite3 native binding, avoiding a second install
# (and the --ignore-scripts trap that left the .node file missing).
RUN corepack enable \
  && pnpm install --frozen-lockfile \
  && pnpm --filter @neuledge/context build \
  && pnpm --filter @neuledge/context deploy --prod --legacy /deploy


FROM node:22-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /deploy ./

EXPOSE 8080

CMD ["node", "dist/cli.js", "serve", "--http", "8080", "--host", "0.0.0.0"]
