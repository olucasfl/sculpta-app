# Build a partir da RAIZ do monorepo:  docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@sim/api...
RUN pnpm --filter @sim/api deploy --legacy --prod /out \
 && cp -r apps/api/dist /out/dist

# Etapa de migração (roda uma vez por deploy): docker build --target migrate ...
FROM build AS migrate
WORKDIR /repo/apps/api
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /out .
USER app
EXPOSE 3000
CMD ["node", "dist/main.js"]
