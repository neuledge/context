FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY . .

RUN corepack enable \
  && pnpm install --frozen-lockfile \
  && pnpm --filter @neuledge/context build


FROM node:22-bookworm-slim AS runtime

WORKDIR /app

COPY --from=build /app/packages/context/dist ./dist
COPY --from=build /app/packages/context/package.json ./package.json

RUN npm install --omit=dev --ignore-scripts

EXPOSE 8080

CMD ["node", "dist/cli.js", "serve", "--http", "8080", "--host", "0.0.0.0"]
