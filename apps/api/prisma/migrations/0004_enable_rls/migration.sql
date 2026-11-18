-- Segurança por linha (RLS) LIGADA em todas as tabelas do app, sem políticas.
--
-- Por quê: no Supabase, as tabelas do schema "public" ficam expostas pela API REST automática
-- (PostgREST) para quem tiver a chave "anon". Com RLS ligada e SEM políticas, os papéis "anon" e
-- "authenticated" não leem nem escrevem nada. A nossa API conecta como dono das tabelas
-- ("postgres"), que ignora a RLS, então nada muda para ela.
--
-- A RLS por clínica (políticas com app.clinic_id) é a sub-etapa 1B.8 e acrescenta políticas
-- em cima disto.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', 'public', t.tablename);
  END LOOP;
END
$$;
