import { describe, expect, it } from 'vitest';
import { distanceForZone, zoneBounds } from './zone';

describe('zona do procedimento', () => {
  // 4 vértices em quadrado de 2 cm no plano z = 0,1; só 3 pesam
  const positions = [0, 0, 0.1, 0.02, 0, 0.1, 0, 0.02, 0.1, 0.5, 0.5, 0.5, 0.02, 0.02, 0.1];
  const weights = [1, 1, 1, 0, 1];

  it('acha o centro e o tamanho só dos vértices com peso', () => {
    const z = zoneBounds(positions, [weights])!;
    expect(z.vertices).toBe(4);
    expect(z.center[0]).toBeCloseTo(0.01);
    expect(z.center[1]).toBeCloseTo(0.01);
    expect(z.radius).toBeCloseTo(0.01);
  });

  it('une regiões e devolve null quando a zona está vazia', () => {
    const outra = [0, 0, 0, 1, 0];
    expect(zoneBounds(positions, [weights, outra])!.vertices).toBe(5);
    expect(zoneBounds(positions, [[0, 0, 0, 0, 0]])).toBeNull();
  });

  it('a câmera chega mais perto de zonas pequenas e respeita os limites', () => {
    expect(distanceForZone(0.01)).toBe(0.26); // lábio: no mínimo
    expect(distanceForZone(0.05)).toBeGreaterThan(distanceForZone(0.03));
    expect(distanceForZone(0.5)).toBe(0.62); // zona enorme: distância padrão
  });
});
