-- E5: anotações da equipe por paciente (linha do tempo), com RLS por clínica como as demais tabelas.
CREATE TABLE "patient_notes" (
  "id" UUID NOT NULL,
  "clinic_id" UUID NOT NULL,
  "patient_id" UUID NOT NULL,
  "author_id" UUID NOT NULL,
  "text" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "patient_notes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "patient_notes_clinic_id_patient_id_created_at_idx" ON "patient_notes"("clinic_id", "patient_id", "created_at");
ALTER TABLE "patient_notes" ADD CONSTRAINT "patient_notes_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "patient_notes" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "patient_notes" TO sculpta_app;
DROP POLICY IF EXISTS tenant_isolation ON "patient_notes";
CREATE POLICY tenant_isolation ON "patient_notes" TO sculpta_app
  USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
