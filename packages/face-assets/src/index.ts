import { SLIDER_SCHEMA_VERSION } from '@sim/contracts';
import { buildSliderBases } from './bases.js';
import { writeGlb } from './glb.js';
import { REGION_LABEL, REGION_ORDER } from './regions.js';
import { buildTemplateHead, UNIT_TO_METERS } from './template.js';

export { buildSliderBases, SLIDER_MAX, type MorphTarget, type SliderBases } from './bases.js';
export { readGlbJson, writeGlb, type GlbInput } from './glb.js';
export { REGION_LABEL, REGION_ORDER, regionWeights } from './regions.js';
export { buildTemplateHead, faceRelief, UNIT_TO_METERS, type TemplateMesh } from './template.js';

/** Metadados gravados em `mesh.extras` do .glb e lidos pelo simulador. */
export interface FaceMeshExtras {
  targetNames: string[];
  kind: 'TEMPLATE' | 'RECONSTRUCTION';
  sliderSchemaVersion: number;
  regions: string[];
  eyes?: { centers: [number, number, number][]; radius: number };
  notice: string;
}

/** Gera o .glb do template demonstrativo, com bases de todos os sliders. */
export function buildTemplateGlb(): Uint8Array {
  const mesh = buildTemplateHead();
  const bases = buildSliderBases(mesh);
  const n = mesh.positions.length / 3;
  const scalarAttributes: Record<string, Float32Array> = {};
  REGION_ORDER.forEach((r, k) => {
    const a = new Float32Array(n);
    for (let v = 0; v < n; v++) a[v] = bases.regionWeights[v * REGION_ORDER.length + k]!;
    scalarAttributes[`_REGION_${r.toUpperCase()}`] = a;
  });
  const extras: Omit<FaceMeshExtras, 'targetNames'> = {
    kind: 'TEMPLATE',
    sliderSchemaVersion: SLIDER_SCHEMA_VERSION,
    regions: REGION_ORDER.map((r) => `${r}:${REGION_LABEL[r]}`),
    eyes: { centers: mesh.eyeCenters.map((c) => c.map((v) => v * UNIT_TO_METERS) as [number, number, number]), radius: mesh.eyeRadius * UNIT_TO_METERS },
    notice: 'Modelo genérico demonstrativo. Não representa nenhum paciente.',
  };
  return writeGlb({
    positions: mesh.positions,
    normals: mesh.normals,
    indices: mesh.indices,
    targets: bases.targets.map((t) => ({ name: t.id, positions: t.positions, normals: t.normals })),
    scalarAttributes,
    extras,
    scale: UNIT_TO_METERS,
  });
}
