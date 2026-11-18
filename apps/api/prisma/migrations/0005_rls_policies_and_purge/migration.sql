-- 1B.8: políticas de RLS por clínica (defesa em profundidade) e estado DELETED da clínica.
--
-- Como funciona: o tráfego "normal" pode usar o papel sculpta_app (sem BYPASSRLS). A cada requisição, a API
-- abre a transação com  set_config('app.clinic_id', <clínica>, true)  e as políticas só deixam ver/alterar as
-- linhas daquela clínica. Sem app.clinic_id definido, o papel vê ZERO linhas.
--
-- ESTADO ATUAL: as políticas e o papel existem e são testados, mas a API ainda conecta como dono das tabelas
-- (que ignora a RLS). Ligar a API ao papel restrito é um passo separado (docs/CONTAS-CLINICAS-PERMISSOES.md, 1B.8).

-- Estado final da clínica excluída (dados apagados; fica só o registro mínimo).
ALTER TYPE "ClinicStatus" ADD VALUE IF NOT EXISTS 'DELETED';
ALTER TABLE "clinics" ADD COLUMN "purged_at" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sculpta_app') THEN
    CREATE ROLE sculpta_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO sculpta_app;

-- Clínica ativa da requisição (texto vazio ou ausente = nenhuma).
CREATE OR REPLACE FUNCTION app_clinic_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.clinic_id', true), '')::uuid
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['memberships','invitations','support_access','patients','consents','capture_sessions','reconstructions','simulations','audit_logs']
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO sculpta_app', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO sculpta_app USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())',
      t
    );
  END LOOP;
END
$$;

-- Tabelas filhas, sem clinic_id próprio: herdam da tabela mãe.
GRANT SELECT, INSERT, UPDATE, DELETE ON photos, simulation_versions TO sculpta_app;
DROP POLICY IF EXISTS tenant_isolation ON photos;
CREATE POLICY tenant_isolation ON photos TO sculpta_app
  USING (EXISTS (SELECT 1 FROM capture_sessions c WHERE c.id = photos.capture_id AND c.clinic_id = app_clinic_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM capture_sessions c WHERE c.id = photos.capture_id AND c.clinic_id = app_clinic_id()));
DROP POLICY IF EXISTS tenant_isolation ON simulation_versions;
CREATE POLICY tenant_isolation ON simulation_versions TO sculpta_app
  USING (EXISTS (SELECT 1 FROM simulations s WHERE s.id = simulation_versions.simulation_id AND s.clinic_id = app_clinic_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM simulations s WHERE s.id = simulation_versions.simulation_id AND s.clinic_id = app_clinic_id()));

-- Tabelas que não são "de clínica" (contas, clínicas, sessões): o papel restrito não as lê nem escreve por aqui.
-- (clinics, users e refresh_tokens continuam acessíveis só ao dono, que é quem a API usa para autenticar.)
