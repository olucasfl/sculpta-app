import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, irisColor, skinColor } from './appearance';
import { buildHairGeometry } from './hair';

/** Cabeça de teste: esfera de raio 0,1 com a "frente" em +z, como o template. */
const head = () => new THREE.SphereGeometry(0.1, 48, 32);

const trianglesAbove = (g: THREE.BufferGeometry, y: number) => {
  const pos = g.getAttribute('position');
  const idx = g.getIndex()!;
  let n = 0;
  for (let i = 0; i < idx.count; i += 3) if ([0, 1, 2].every((k) => pos.getY(idx.getX(i + k)) > y)) n++;
  return n;
};

describe('molde de cabelo', () => {
  it('cobre o alto e o fundo da cabeça, não o rosto', () => {
    const g = buildHairGeometry(head(), { volume: 0.5, length: 0.25, hairline: 0.4 })!;
    expect(g).not.toBeNull();
    const pos = g.getAttribute('position');
    let faceFront = 0;
    for (let i = 0; i < pos.count; i++) {
      // ponto da frente do rosto, na altura do nariz/boca: não deve ter casca
      if (pos.getZ(i) > 0.08 && Math.abs(pos.getY(i)) < 0.04) faceFront++;
    }
    expect(faceFront).toBe(0);
    expect(trianglesAbove(g, 0.05)).toBeGreaterThan(50);
  });

  it('cabelo mais longo cobre mais da cabeça; entradas mais altas descobrem a testa', () => {
    const short = buildHairGeometry(head(), { volume: 0.5, length: 0, hairline: 0.4 })!;
    const long = buildHairGeometry(head(), { volume: 0.5, length: 1, hairline: 0.4 })!;
    expect(long.getIndex()!.count).toBeGreaterThan(short.getIndex()!.count);
    const low = buildHairGeometry(head(), { volume: 0.5, length: 0.25, hairline: 0 })!;
    const high = buildHairGeometry(head(), { volume: 0.5, length: 0.25, hairline: 1 })!;
    expect(low.getIndex()!.count).toBeGreaterThan(high.getIndex()!.count);
  });

  it('volume maior afasta a casca do crânio; a borda se funde (espessura ~0)', () => {
    const thin = buildHairGeometry(head(), { volume: 0, length: 0.25, hairline: 0.4 })!;
    const thick = buildHairGeometry(head(), { volume: 1, length: 0.25, hairline: 0.4 })!;
    const maxR = (g: THREE.BufferGeometry) => {
      const p = g.getAttribute('position');
      let m = 0;
      for (let i = 0; i < p.count; i++) m = Math.max(m, Math.hypot(p.getX(i), p.getY(i), p.getZ(i)));
      return m;
    };
    expect(maxR(thick)).toBeGreaterThan(maxR(thin));
    expect(maxR(thick)).toBeLessThan(0.1 + 0.02);
    const w = thick.getAttribute('aWeight');
    expect(Math.min(...Array.from(w.array as Float32Array))).toBeLessThan(0.05);
  });
});

describe('aparência', () => {
  it('tom de pele vai de clara a escura; a cor da foto tem prioridade', () => {
    const light = skinColor({ ...DEFAULT_APPEARANCE, skinTone: 0 });
    const dark = skinColor({ ...DEFAULT_APPEARANCE, skinTone: 1 });
    expect(light).toBe('#e9cdbb');
    expect(dark).toBe('#8a5a3c');
    expect(skinColor({ ...DEFAULT_APPEARANCE, skinHex: '#aa8866' })).toBe('#aa8866');
  });

  it('cor da íris: a da foto vale no lugar da escolhida', () => {
    expect(irisColor({ ...DEFAULT_APPEARANCE, eyeColor: 'azul' })).toBe('#4a74a8');
    expect(irisColor({ ...DEFAULT_APPEARANCE, irisHex: '#112233' })).toBe('#112233');
  });
});
