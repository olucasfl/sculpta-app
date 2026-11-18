-- Escultura com o pincel: deslocamentos por vértice guardados junto da versão da simulação.
ALTER TABLE "simulation_versions" ADD COLUMN "sculpt" JSONB;
