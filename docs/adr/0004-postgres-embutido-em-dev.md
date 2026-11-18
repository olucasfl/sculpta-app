# 0004 — Postgres embutido (PGlite) em desenvolvimento e testes

- Status: aceito
- Data: 2026-11-18

## Contexto
Nem toda máquina de desenvolvimento tem Docker. Os testes de isolamento precisam de Postgres de verdade (enums, arrays, `ILIKE`).

## Decisão
`pnpm db:dev` sobe o PGlite (Postgres compilado para WASM) atrás de `@electric-sql/pglite-socket`, que fala o protocolo do Postgres. A API usa o mesmo `@prisma/adapter-pg` de produção, e as migrations são aplicadas por `prisma migrate deploy`. Os testes e2e sobem um PGlite em memória por arquivo e aplicam o SQL das migrations.

## Consequências
- `pnpm install && pnpm db:dev` basta para rodar tudo local, sem Docker.
- O PGlite é um único processo Postgres com multiplexador de conexões: serve para dev/teste, não para produção.
- Staging e produção usam Postgres 16 gerenciado; o `docker-compose.yml` continua disponível.
