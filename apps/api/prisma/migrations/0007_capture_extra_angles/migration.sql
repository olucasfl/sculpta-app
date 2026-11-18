-- E4: vistas extras (20° e queixo para cima/baixo) e inclinação da cabeça por foto.
ALTER TYPE "PhotoAngle" ADD VALUE IF NOT EXISTS 'LEFT_20';
ALTER TYPE "PhotoAngle" ADD VALUE IF NOT EXISTS 'RIGHT_20';
ALTER TYPE "PhotoAngle" ADD VALUE IF NOT EXISTS 'CHIN_UP';
ALTER TYPE "PhotoAngle" ADD VALUE IF NOT EXISTS 'CHIN_DOWN';
ALTER TABLE "photos" ADD COLUMN "pitch_deg" DOUBLE PRECISION;
