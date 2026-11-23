import type { FaceRegion } from '@sim/contracts';
import { falloff, segmentDistance } from './math.js';

/**
 * Máscaras de região com pesos suaves (0–1), definidas sobre o template em unidades u.
 * Com o FLAME, estas funções viram índices/pesos pintados uma vez sobre a topologia fixa.
 */
export const REGION_ORDER: FaceRegion[] = ['nose', 'lips', 'chin', 'jaw', 'malar', 'infraorbital', 'nasolabial', 'temple', 'masseter'];

export const REGION_LABEL: Record<FaceRegion, string> = {
  nose: 'Nariz',
  lips: 'Lábios',
  chin: 'Mento',
  jaw: 'Mandíbula',
  malar: 'Malar',
  infraorbital: 'Infraorbital',
  nasolabial: 'Sulco nasolabial',
  temple: 'Têmpora',
  masseter: 'Masseter',
};

/** Elipse 2D (frente do rosto) com decaimento suave. */
const ellipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
  falloff(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2);

export interface SubWeights {
  dorsum: number;
  tip: number;
  alar: number;
  upperLip: number;
  lowerLip: number;
  vermilion: number;
  chinLower: number;
}

/**
 * Pesos de cada região para um ponto do template. `front` (0–1) zera a nuca e as costas.
 * Regiões bilaterais usam |x| (simétricas).
 */
export function regionWeights(x: number, y: number, front: number): Record<FaceRegion, number> & { sub: SubWeights } {
  const ax = Math.abs(x);
  const f = front;
  const nose = ellipse(x, y, 0, -0.02, 0.15, 0.28) * f;
  const lips = ellipse(x, y, 0, -0.47, 0.24, 0.11) * f;
  const chin = ellipse(x, y, 0, -0.77, 0.21, 0.17) * f;
  // Ângulo da mandíbula fica na lateral: usa uma máscara frontal mais permissiva.
  const jaw = ellipse(ax, y, 0.55, -0.66, 0.22, 0.22) * Math.min(1, f * 3 + 0.2);
  const malar = ellipse(ax, y, 0.4, -0.02, 0.17, 0.14) * f;
  const infraorbital = ellipse(ax, y, 0.24, 0.05, 0.14, 0.07) * f;
  const fold = segmentDistance(ax, y, 0.12, -0.26, 0.22, -0.52);
  const nasolabial = falloff(fold.d2 / 0.06 ** 2) * f;

  const sub: SubWeights = {
    dorsum: ellipse(x, y, 0, 0.03, 0.09, 0.2) * f,
    tip: ellipse(x, y, 0, -0.2, 0.1, 0.09) * f,
    alar: ellipse(ax, y, 0.1, -0.22, 0.075, 0.06) * f,
    upperLip: ellipse(x, y, 0, -0.43, 0.2, 0.055) * f,
    lowerLip: ellipse(x, y, 0, -0.515, 0.18, 0.06) * f,
    vermilion:
      (Math.exp(-((y + 0.4) ** 2) / (2 * 0.012 ** 2)) + Math.exp(-((y + 0.55) ** 2) / (2 * 0.012 ** 2))) *
      ellipse(x, y, 0, -0.475, 0.2, 0.12) *
      f,
    chinLower: chin * Math.min(1, Math.max(0, (-0.62 - y) / 0.2)),
  };
  // Têmpora: acima e atrás do olho, na lateral; masseter: ângulo da mandíbula e bochecha baixa. Ambas laterais.
  const lateral = Math.min(1, f * 3 + 0.2);
  const temple = ellipse(ax, y, 0.58, 0.3, 0.14, 0.15) * lateral;
  const masseter = ellipse(ax, y, 0.6, -0.55, 0.16, 0.2) * lateral;
  return { nose, lips, chin, jaw, malar, infraorbital, nasolabial, temple, masseter, sub };
}
