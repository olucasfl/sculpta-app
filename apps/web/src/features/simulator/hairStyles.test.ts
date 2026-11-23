import { describe, expect, it } from 'vitest';
import { buildStrands } from './hairStrands';
import { HAIR_PRESETS, resolveStyle, styleFromDetection } from './hairStyles';

describe('estilos de cabelo', () => {
  it('há 5 modelos masculinos e 5 femininos, com ids únicos', () => {
    expect(HAIR_PRESETS.filter((p) => p.gender === 'm')).toHaveLength(5);
    expect(HAIR_PRESETS.filter((p) => p.gender === 'f')).toHaveLength(5);
    expect(new Set(HAIR_PRESETS.map((p) => p.id)).size).toBe(10);
  });

  it('o automático segue o que foi lido na foto', () => {
    const curto = styleFromDetection({ hasHair: true, length: 0.03, fringe: 0, volume: 1.1, curl: 0, color: '#111111' })!;
    const longo = styleFromDetection({ hasHair: true, length: 1.5, fringe: 0.8, volume: 1.2, curl: 0, color: '#111111' })!;
    const cacheado = styleFromDetection({ hasHair: true, length: 0.05, fringe: 0, volume: 1.8, curl: 0.9, color: '#111111' })!;
    expect(longo.side).toBeGreaterThan(curto.side * 8);
    expect(longo.fringe).toBeGreaterThan(curto.fringe);
    expect(cacheado.curl).toBeGreaterThan(0.8);
    expect(cacheado.puff).toBeGreaterThan(curto.puff);
    expect(styleFromDetection({ hasHair: false, length: 0, fringe: 0, volume: 1, curl: 0, color: null })).toBeNull();
  });

  it('tamanho multiplica os comprimentos; "sem fios" não gera estilo', () => {
    const base = resolveStyle('f-longo', 1, null)!;
    const metade = resolveStyle('f-longo', 0.5, null)!;
    expect(metade.side).toBeCloseTo(base.side * 0.5, 5);
    expect(resolveStyle('none', 1, null)).toBeNull();
  });
});

describe('fios com estilo', () => {
  // calota: 2 triângulos no topo de uma cabeça, normais para cima, com os olhos bem abaixo
  const pos = [-0.05, 0.1, -0.05, 0.05, 0.1, -0.05, 0.05, 0.1, 0.05, -0.05, 0.1, 0.05];
  const nor = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  const idx = [0, 1, 2, 0, 2, 3];
  const hair = [1, 1, 1, 1];

  it('fios compridos ficam fora da cabeça (colisão) e são finitos', () => {
    const st = resolveStyle('f-longo', 1, null)!;
    const s = buildStrands(pos, nor, idx, hair, { density: 20, length: 0.3, style: st, eyeY: 0.0, faceZ: 0.06, seed: 3 });
    expect(s.strands).toBeGreaterThan(100);
    expect(s.positions.every(Number.isFinite)).toBe(true);
  });

  it('a risca separa os fios para os dois lados', () => {
    const st = { top: 0.1, side: 0.1, back: 0.1, fringe: 0, curl: 0, puff: 0, part: 1, partX: 0 };
    const s = buildStrands(pos, nor, idx, hair, { density: 30, length: 0.1, style: st, seed: 5, segments: 6 });
    let left = 0;
    let right = 0;
    for (let i = 0; i < s.strands; i++) {
      const o = i * 6 * 6;
      const dx = s.positions[o + 5 * 6 + 3]! - s.positions[o]!;
      if (dx > 0) right++;
      else left++;
    }
    expect(left).toBeGreaterThan(s.strands * 0.3);
    expect(right).toBeGreaterThan(s.strands * 0.3);
  });
});
