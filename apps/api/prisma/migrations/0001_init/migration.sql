-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'PROFISSIONAL', 'RECEPCAO');

-- CreateEnum
CREATE TYPE "ConsentScope" AS ENUM ('SIMULATION', 'MARKETING', 'RESEARCH');

-- CreateEnum
CREATE TYPE "SignerRelation" AS ENUM ('PACIENTE', 'RESPONSAVEL_LEGAL');

-- CreateEnum
CREATE TYPE "PhotoAngle" AS ENUM ('FRONT', 'LEFT_45', 'RIGHT_45', 'LEFT_90', 'RIGHT_90');

-- CreateEnum
CREATE TYPE "PhotoValidation" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "CaptureStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ReconstructionStatus" AS ENUM ('QUEUED', 'PROCESSING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconstructionSource" AS ENUM ('VGGTFACE', 'TEMPLATE', 'FALLBACK_FIT');

-- CreateTable
CREATE TABLE "clinics" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cnpj" TEXT,
    "retention_days" INTEGER NOT NULL DEFAULT 1825,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "rotated_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "internal_code" TEXT,
    "phone" TEXT,
    "birth_date" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "term_version" TEXT NOT NULL,
    "scopes" "ConsentScope"[],
    "signer_name" TEXT NOT NULL,
    "signer_relation" "SignerRelation" NOT NULL,
    "signature_key" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "collected_by_id" UUID NOT NULL,
    "signed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_id" UUID,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capture_sessions" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "captured_by_id" UUID NOT NULL,
    "status" "CaptureStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capture_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photos" (
    "id" UUID NOT NULL,
    "capture_id" UUID NOT NULL,
    "angle" "PhotoAngle" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "yaw_deg" DOUBLE PRECISION,
    "sharpness" DOUBLE PRECISION,
    "face_detected" BOOLEAN,
    "validation" "PhotoValidation" NOT NULL DEFAULT 'AUTO',
    "landmarks" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconstructions" (
    "id" UUID NOT NULL,
    "capture_id" UUID NOT NULL,
    "source" "ReconstructionSource" NOT NULL,
    "status" "ReconstructionStatus" NOT NULL DEFAULT 'QUEUED',
    "mesh_key" TEXT,
    "quality_score" DOUBLE PRECISION,
    "slider_schema_version" INTEGER NOT NULL DEFAULT 1,
    "metrics" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "reconstructions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulations" (
    "id" UUID NOT NULL,
    "reconstruction_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulation_versions" (
    "id" UUID NOT NULL,
    "simulation_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "params" JSONB NOT NULL,
    "thumbnail_key" TEXT,
    "mesh_key" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulation_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinics_cnpj_key" ON "clinics"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_clinic_id_idx" ON "users"("clinic_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "patients_clinic_id_deleted_at_idx" ON "patients"("clinic_id", "deleted_at");

-- CreateIndex
CREATE INDEX "consents_clinic_id_patient_id_idx" ON "consents"("clinic_id", "patient_id");

-- CreateIndex
CREATE INDEX "capture_sessions_clinic_id_patient_id_idx" ON "capture_sessions"("clinic_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "photos_capture_id_angle_key" ON "photos"("capture_id", "angle");

-- CreateIndex
CREATE INDEX "audit_logs_clinic_id_created_at_idx" ON "audit_logs"("clinic_id", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capture_sessions" ADD CONSTRAINT "capture_sessions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_capture_id_fkey" FOREIGN KEY ("capture_id") REFERENCES "capture_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconstructions" ADD CONSTRAINT "reconstructions_capture_id_fkey" FOREIGN KEY ("capture_id") REFERENCES "capture_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulations" ADD CONSTRAINT "simulations_reconstruction_id_fkey" FOREIGN KEY ("reconstruction_id") REFERENCES "reconstructions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulation_versions" ADD CONSTRAINT "simulation_versions_simulation_id_fkey" FOREIGN KEY ("simulation_id") REFERENCES "simulations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

