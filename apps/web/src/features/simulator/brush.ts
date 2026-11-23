import type { FaceRegion, SliderId } from '@sim/contracts';

/**
 * Pincel de modelagem direta: arrastar sobre uma região (mouse, caneta ou dedo) move os sliders dela.
 * Vertical: arrastar para cima aumenta. Horizontal: arrastar para a direita aumenta.
 * `v` com dois ids = [metade de cima, metade de baixo] da região, conforme onde o toque começou.
 */
export interface BrushMap {
  v: SliderId | [SliderId, SliderId];
  h?: SliderId;
}

export const BRUSH: Record<FaceRegion, BrushMap> = {
  nose: { v: 'nose.tipProjection', h: 'nose.bridgeWidth' },
  lips: { v: ['lips.upperVolume', 'lips.lowerVolume'], h: 'lips.contour' },
  chin: { v: 'chin.projection', h: 'chin.height' },
  jaw: { v: 'jaw.width' },
  malar: { v: 'malar.volume', h: 'malar.projection' },
  infraorbital: { v: 'infraorbital.volume' },
  nasolabial: { v: 'nasolabial.volume' },
  temple: { v: 'temple.volume' },
  masseter: { v: 'masseter.reduction' },
};

/** Pixels de arrasto para ir de 0 a 100% de um slider. */
export const PIXELS_PER_UNIT = 180;

export function brushTargets(region: FaceRegion, upper: boolean): { v: SliderId; h?: SliderId } {
  const m = BRUSH[region];
  return { v: Array.isArray(m.v) ? (upper ? m.v[0] : m.v[1]) : m.v, h: m.h };
}
