-- Contas, clínicas e permissões (etapa 1B.2), fase "EXPANDIR".
-- Cria o modelo novo (vínculos, convites, suporte) SEM remover as colunas antigas de users;
-- o código novo lê só os vínculos. A fase "contrair" (migração futura) remove users.clinic_id e users.role.

-- CreateEnum
CREATE TYPE "ClinicRole" AS ENUM ('OWNER', 'GERENTE', 'PROFISSIONAL', 'AUXILIAR', 'RECEPCAO', 'VISUALIZADOR');
CREATE TYPE "ClinicStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_DELETION');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED');
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- AlterTable: clinics
ALTER TABLE "clinics"
  ADD COLUMN "status" "ClinicStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "logo_key" TEXT,
  ADD COLUMN "deletion_scheduled_at" TIMESTAMP(3),
  ADD COLUMN "created_by_id" UUID;

-- AlterTable: users (conta global; colunas antigas ficam opcionais)
ALTER TABLE "users"
  ADD COLUMN "email_verified_at" TIMESTAMP(3),
  ADD COLUMN "is_platform_admin" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "last_login_at" TIMESTAMP(3),
  ALTER COLUMN "password_hash" DROP NOT NULL,
  ALTER COLUMN "clinic_id" DROP NOT NULL,
  ALTER COLUMN "role" DROP NOT NULL;

-- AlterTable: audit_logs (eventos da plataforma não têm clínica)
ALTER TABLE "audit_logs" ALTER COLUMN "clinic_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "role" "ClinicRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "invited_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "ClinicRole" NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invited_by_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "support_access" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "support_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_clinic_id_key" ON "memberships"("user_id", "clinic_id");
CREATE INDEX "memberships_clinic_id_status_idx" ON "memberships"("clinic_id", "status");
CREATE INDEX "invitations_email_status_idx" ON "invitations"("email", "status");
CREATE INDEX "invitations_clinic_id_status_idx" ON "invitations"("clinic_id", "status");
CREATE INDEX "support_access_clinic_id_expires_at_idx" ON "support_access"("clinic_id", "expires_at");
-- Um convite PENDENTE por e-mail/clínica (índice parcial; o Prisma não o declara no schema).
CREATE UNIQUE INDEX "invitations_one_pending_per_email" ON "invitations"("clinic_id", "email") WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: cada usuário antigo vira um vínculo.
-- ADMIN: o primeiro de cada clínica (mais antigo) vira OWNER; os demais, GERENTE.
-- Os usuários antigos já tinham e-mail confiável (criados pelo administrador): marcados como verificados.
INSERT INTO "memberships" ("id", "user_id", "clinic_id", "role", "status", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  u."id",
  u."clinic_id",
  CASE u."role"
    WHEN 'ADMIN' THEN
      CASE WHEN u."id" = (
        SELECT a."id" FROM "users" a
        WHERE a."clinic_id" = u."clinic_id" AND a."role" = 'ADMIN'
        ORDER BY a."created_at", a."id" LIMIT 1
      ) THEN 'OWNER' ELSE 'GERENTE' END
    WHEN 'PROFISSIONAL' THEN 'PROFISSIONAL'
    ELSE 'RECEPCAO'
  END::"ClinicRole",
  CASE WHEN u."active" THEN 'ACTIVE' ELSE 'SUSPENDED' END::"MembershipStatus",
  u."created_at",
  CURRENT_TIMESTAMP
FROM "users" u
WHERE u."clinic_id" IS NOT NULL AND u."role" IS NOT NULL;

UPDATE "users" SET "email_verified_at" = "created_at" WHERE "email_verified_at" IS NULL;
