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

describe('mechas', () => {
  const pos = [-0.05, 0.1, -0.05, 0.05, 0.1, -0.05, 0.05, 0.1, 0.05, -0.05, 0.1, 0.05];
  const nor = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  const idx = [0, 1, 2, 0, 2, 3];
  const hair = [1, 1, 1, 1];

  it('entrega cada fio inteiro e com curva (não é uma reta)', () => {
    const st = { ...resolveStyle('f-medio', 1, null)! };
    const paths: import('./hairStrands').StrandPath[] = [];
    const r = buildStrands(pos, nor, idx, hair, { density: 6, length: 0.2, style: st, segments: 14, seed: 4, eyeY: 0, faceZ: 0.06, onStrand: (s) => paths.push(s) });
    expect(paths.length).toBe(r.strands);
    expect(paths.every((p) => p.pts.length === 15 && p.pts.flat().every(Number.isFinite))).toBe(true);
    // desvio lateral máximo em relação à reta raiz-ponta: há curva
    let curved = 0;
    for (const p of paths) {
      const a = p.pts[0]!, b = p.pts[14]!;
      const d = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
      const L = Math.hypot(d[0]!, d[1]!, d[2]!) || 1;
      let maxDev = 0;
      for (const q of p.pts) {
        const w = [q[0]! - a[0]!, q[1]! - a[1]!, q[2]! - a[2]!];
        const cr = [w[1]! * d[2]! - w[2]! * d[1]!, w[2]! * d[0]! - w[0]! * d[2]!, w[0]! * d[1]! - w[1]! * d[0]!];
        maxDev = Math.max(maxDev, Math.hypot(cr[0]!, cr[1]!, cr[2]!) / L);
      }
      if (maxDev > 0.004) curved++;
    }
    expect(curved).toBeGreaterThan(paths.length * 0.6);
  });

  it('o fluxo perto da coroa não gera fios levantados (sem tufo)', () => {
    const st = { top: 0.04, side: 0.012, back: 0.012, fringe: 0, curl: 0, puff: 0, comb: 0.5 };
    const s = buildStrands(pos, nor, idx, hair, { density: 40, length: 0.04, style: st, seed: 9, segments: 6 });
    let up = 0;
    for (let i = 0; i < s.strands; i++) {
      const o = i * 6 * 6;
      if (s.positions[o + 5 * 6 + 4]! > s.positions[o + 1]! + 0.012) up++; // ponta bem acima da raiz
    }
    expect(up).toBeLessThan(s.strands * 0.05);
  });
});

describe('franja lida na foto', () => {
  const base = { hasHair: true, length: 0.03, volume: 1.1, curl: 0, color: '#111111' };

  it('franja de lado joga os fios para o lado em que ela pesa e põe a risca no outro', () => {
    const esquerda = styleFromDetection({ ...base, fringe: 0.5, fringeSide: 0.7, fringeDepth: 1 })!;
    const direita = styleFromDetection({ ...base, fringe: 0.5, fringeSide: -0.7, fringeDepth: 1 })!;
    expect(esquerda.sweep!).toBeLessThan(-0.4); // esquerda da foto = lado −x do modelo
    expect(direita.sweep!).toBeGreaterThan(0.4);
    expect(esquerda.fringeLen!).toBeGreaterThan(0.06);
    expect(esquerda.partX!).toBeGreaterThan(0); // a risca fica do lado oposto
    expect(direita.partX!).toBeLessThan(0);
  });

  it('franja central ou ausente não tem lado', () => {
    expect(styleFromDetection({ ...base, fringe: 0.5, fringeSide: 0.05 })!.sweep).toBeUndefined();
    const sem = styleFromDetection({ ...base, fringe: 0.05, fringeSide: 0.9 })!;
    expect(sem.sweep).toBeUndefined();
    expect(sem.fringeLen).toBeUndefined();
  });

  it('os fios da franja de lado atravessam a testa para o lado e ficam curtos', () => {
    // calota: 2 triângulos no alto; os de "frente" (z grande) são franja
    const pos = [-0.05, 0.1, 0.0, 0.05, 0.1, 0.0, 0.05, 0.1, 0.06, -0.05, 0.1, 0.06];
    const nor = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
    const idx = [0, 1, 2, 0, 2, 3];
    const st = { top: 0.05, side: 0.014, back: 0.012, fringe: 1, curl: 0, puff: 0, sweep: -0.85, fringeLen: 0.06 };
    const s = buildStrands(pos, nor, idx, [1, 1, 1, 1], { density: 40, length: 0.05, style: st, seed: 3, segments: 6, eyeY: 0.0, faceZ: 0.05 });
    let towardsNegX = 0;
    let frontStrands = 0;
    for (let i = 0; i < s.strands; i++) {
      const o = i * 6 * 6;
      if (s.positions[o + 2]! < 0.04 || s.positions[o]! > -0.02) continue; // só os da frente, do lado em que a franja pesa
      frontStrands++;
      if (s.positions[o + 5 * 6 + 3]! < s.positions[o]!) towardsNegX++;
    }
    expect(frontStrands).toBeGreaterThan(20);
    expect(towardsNegX).toBeGreaterThan(frontStrands * 0.8);
  });
});
