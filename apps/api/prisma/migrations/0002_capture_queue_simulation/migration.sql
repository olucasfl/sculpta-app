-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "photos" ADD COLUMN     "face_height_ratio" DOUBLE PRECISION,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'CAMERA';

-- AlterTable
ALTER TABLE "reconstructions" ADD COLUMN     "clinic_id" UUID NOT NULL,
ADD COLUMN     "error_detail" TEXT,
ADD COLUMN     "locked_at" TIMESTAMP(3),
ADD COLUMN     "next_run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "patient_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "simulations" ADD COLUMN     "clinic_id" UUID NOT NULL,
ADD COLUMN     "patient_id" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "reconstructions_status_next_run_at_idx" ON "reconstructions"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "reconstructions_clinic_id_patient_id_idx" ON "reconstructions"("clinic_id", "patient_id");

-- CreateIndex
CREATE INDEX "simulations_clinic_id_patient_id_idx" ON "simulations"("clinic_id", "patient_id");

