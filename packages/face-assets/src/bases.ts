import { SLIDERS, type FaceRegion, type SliderId } from '@sim/contracts';
import { computeNormals } from './math.js';
import { REGION_ORDER, regionWeights } from './regions.js';
import type { TemplateMesh } from './template.js';

/**
 * Deslocamento máximo de cada slider (valor 1), em unidades u do template.
 * Equivale ao `sliders.json` do planejamento. É VISUAL: não corresponde a milímetros,
 * dose ou volume de produto. Validar as faixas com um profissional.
 */
export const SLIDER_MAX: Record<SliderId, number> = {
  'nose.bridgeWidth': 0.35,
  'nose.dorsumHeight': 0.035,
  'nose.tipProjection': 0.05,
  'nose.tipRotation': 0.035,
  'nose.alarWidth': 0.45,
  'lips.upperVolume': 0.03,
  'lips.lowerVolume': 0.032,
  'lips.contour': 0.012,
  'chin.projection': 0.07,
  'chin.height': 0.06,
  'jaw.width': 0.05,
  'malar.volume': 0.035,
  'malar.projection': 0.04,
  'infraorbital.volume': 0.016,
  'nasolabial.volume': 0.02,
  'temple.volume': 0.03,
  'masseter.reduction': 0.03,
};

export interface MorphTarget {
  id: SliderId;
  region: FaceRegion;
  /** Delta de posição por vértice (valor do slider = 1). */
  positions: Float32Array;
  normals: Float32Array;
}

export interface SliderBases {
  targets: MorphTarget[];
  /** Pesos de região por vértice, na ordem de REGION_ORDER (9 por vértice). */
  regionWeights: Float32Array;
}

/**
 * Bases de deformação: um morph target por slider (ADR 0002).
 * No worker real, cada base vem de deformação biharmônica (libigl) sobre o FLAME;
 * aqui, deslocamentos suaves ponderados pelas máscaras.
 */
export function buildSliderBases(mesh: TemplateMesh): SliderBases {
  const n = mesh.positions.length / 3;
  const P = mesh.positions, N = mesh.normals;
  const deltas = new Map<SliderId, Float32Array>(SLIDERS.map((s) => [s.id, new Float32Array(n * 3)]));
  const rw = new Float32Array(n * REGION_ORDER.length);

  for (let i = 0; i < n; i++) {
    const x = P[i * 3]!, y = P[i * 3 + 1]!;
    const nx = N[i * 3]!, ny = N[i * 3 + 1]!, nz = N[i * 3 + 2]!;
    const w = regionWeights(x, y, mesh.front[i]!);
    REGION_ORDER.forEach((r, k) => (rw[i * REGION_ORDER.length + k] = w[r]));
    const sx = Math.sign(x);
    const set = (id: SliderId, dx: number, dy: number, dz: number) => {
      const d = deltas.get(id)!, m = SLIDER_MAX[id];
      d[i * 3] = dx * m;
      d[i * 3 + 1] = dy * m;
      d[i * 3 + 2] = dz * m;
    };
    const along = (id: SliderId, weight: number) => set(id, nx * weight, ny * weight, nz * weight);

    // Nariz (escalas laterais são relativas a x: o centro não se move)
    set('nose.bridgeWidth', x * w.sub.dorsum, 0, 0);
    set('nose.dorsumHeight', 0, 0, w.sub.dorsum * w.nose);
    set('nose.tipProjection', 0, 0, w.sub.tip);
    set('nose.tipRotation', 0, w.sub.tip, 0);
    set('nose.alarWidth', x * w.sub.alar, 0, 0);
    // Lábios: volume com peso maior no centro
    along('lips.upperVolume', w.sub.upperLip * (1 - 0.35 * Math.min(1, (x / 0.2) ** 2)));
    along('lips.lowerVolume', w.sub.lowerLip * (1 - 0.35 * Math.min(1, (x / 0.18) ** 2)));
    set('lips.contour', 0, 0, Math.min(1, w.sub.vermilion));
    // Mento e mandíbula
    set('chin.projection', 0, -0.15 * w.chin, w.chin);
    set('chin.height', 0, -w.sub.chinLower, 0.2 * w.sub.chinLower);
    set('jaw.width', sx * w.jaw, 0, 0.2 * w.jaw);
    // Malar: volume na normal e projeção diagonal (frente, cima, para fora)
    along('malar.volume', w.malar);
    set('malar.projection', sx * 0.35 * w.malar, 0.35 * w.malar, 0.87 * w.malar);
    // Suavizações
    along('infraorbital.volume', w.infraorbital);
    along('nasolabial.volume', w.nasolabial);
    // Têmpora: volume; masseter: a lateral entra (afina o terço inferior)
    along('temple.volume', w.temple);
    set('masseter.reduction', -sx * w.masseter, 0, -0.1 * w.masseter);
  }

  const targets: MorphTarget[] = SLIDERS.map((s) => {
    const dp = deltas.get(s.id)!;
    const moved = new Float32Array(P.length);
    for (let k = 0; k < P.length; k++) moved[k] = P[k]! + dp[k]!;
    const nn = computeNormals(moved, mesh.indices);
    const dn = new Float32Array(N.length);
    for (let k = 0; k < N.length; k++) dn[k] = nn[k]! - N[k]!;
    // Zera ruído numérico: fora da região a normal não muda (deixa o morph esparso pequeno).
    for (let k = 0; k < dn.length; k++) if (Math.abs(dn[k]!) < 1e-5) dn[k] = 0;
    return { id: s.id, region: s.region, positions: dp, normals: dn };
  });

  return { targets, regionWeights: rw };
}
