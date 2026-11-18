# Operação — backup, retenção, observabilidade e staging

Estado em 18/11/2026. **Nada daqui foi executado em produção nem em staging**: são procedimentos para quando houver ambiente.

## Banco de dados

- **Desenvolvimento:** PGlite (`pnpm db:dev`), dados em `apps/api/.data/pglite`. Pode ser apagado à vontade.
- **Banco real:** Supabase (`DB_TARGET=supabase`). Migrações com `prisma migrate deploy` pelo pooler em modo sessão (porta 5432).
- **Migrações:** versionadas em `apps/api/prisma/migrations` (0001 a 0008). Nunca edite uma migração já aplicada; crie outra. `pnpm --filter @sim/api db:migrate:diff` mostra a diferença entre o schema e as migrações.

### Backup e restauração (a testar antes de pacientes reais)

1. Backup lógico, com a URL de conexão **em variável de ambiente, nunca no comando versionado**:
   ```bash
   pg_dump --format=custom --no-owner --file=backup.dump "$DATABASE_URL"
   ```
2. Restauração num banco vazio de teste:
   ```bash
   pg_restore --no-owner --dbname="$TEST_DATABASE_URL" backup.dump
   ```
3. Conferir: contagem de linhas de `patients`, `consents`, `captures`, `simulations` iguais, e subir a API contra o banco restaurado.
4. O Supabase tem backups próprios (dependem do plano); isso **não substitui** um teste de restauração.
5. **As fotos e os modelos não estão no banco:** ficam no armazenamento (disco, MinIO ou S3). Faça backup dele também, com a mesma retenção, e lembre que backup guarda dado biométrico: o prazo e a eliminação valem para ele também.

## Retenção

- Cada clínica define o prazo em Configurações. O expurgo roda uma vez por dia (`RETENTION_ENABLED=true`) e apaga fotos, malhas e simulações de pacientes sem atividade dentro do prazo. O cadastro fica.
- O expurgo manual existe só na API (`POST /api/clinic/retention/run`, permissão da dona); **não há botão na tela**.
- O expurgo é auditado (`RETENTION_PURGE`). Backups antigos continuam com os dados: defina quanto tempo guardá-los.

## Observabilidade

- **Hoje:** logs do Nest no console, sem corpo de requisição nem dado do paciente; auditoria de ações na tabela `audit_logs` (visível em Configurações).
- **Falta:** métricas de fila e de reconstrução (tempo, falhas, tentativas), alertas, e coleta central de logs. Sugestão: expor contagens da fila (`reconstructions` por status) e tempo médio por reconstrução.
- Regra: **nenhum log pode ter nome, foto, URL pré-assinada ou token**.

## Staging (a montar)

1. HTTPS na frente (o compose já tem nginx com CSP para o web); `COOKIE_SECURE=true`.
2. `JWT_SECRET` e `WORKER_SECRET` novos e longos, em gerenciador de segredos.
3. Banco e armazenamento **no Brasil** (São Paulo).
4. Rodar o roteiro de demonstração do README ponta a ponta.
5. Antes de abrir para fora: verificação de e-mail e recuperação de senha (hoje não existem).

## Dependências

- `pnpm audit --prod --audit-level high` roda no CI; em 18/11/2026 não apontou vulnerabilidades conhecidas.
- O worker Python usa `pip-audit` no CI; **não foi executado localmente** (sem Python nesta máquina).
