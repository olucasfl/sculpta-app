# Build a partir da RAIZ do monorepo:  docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@sim/web...

FROM nginx:1.27-alpine
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
# Origem do storage (URLs pré-assinadas) liberada na CSP, ex.: https://bucket.r2.cloudflarestorage.com
ENV STORAGE_ORIGIN=""
ENV API_UPSTREAM=http://api:3000
EXPOSE 80
