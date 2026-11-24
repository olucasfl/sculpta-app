import { describe, expect, it } from 'vitest';
import { buildStrands, mulberry32, orientationField } from './hairStrands';

/** Disco plano no topo de uma "cabeça" (y = 0,1), com normais para cima: 2 triângulos de 10 x 10 cm. */
function quad(hairA: number, hairB: number) {
  const pos = [-0.05, 0.1, -0.05, 0.05, 0.1, -0.05, 0.05, 0.1, 0.05, -0.05, 0.1, 0.05];
  const nor = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  const idx = [0, 1, 2, 0, 2, 3];
  const hair = [hairA, hairA, hairB, hairB];
  return { pos, nor, idx, hair };
}

describe('cabelo em fios', () => {
  it('é determinístico e a densidade controla a quantidade', () => {
    const q = quad(1, 1);
    const a = buildStrands(q.pos, q.nor, q.idx, q.hair, { density: 40, length: 0.05, seed: 7 });
    const b = buildStrands(q.pos, q.nor, q.idx, q.hair, { density: 40, length: 0.05, seed: 7 });
    expect(a.strands).toBe(b.strands);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    // 100 cm² x 40 fios/cm² = 4000, com a sorteio das frações
    expect(a.strands).toBeGreaterThan(3900);
    expect(a.strands).toBeLessThan(4100);
    const dobro = buildStrands(q.pos, q.nor, q.idx, q.hair, { density: 80, length: 0.05, seed: 7 });
    expect(dobro.strands).toBeGreaterThan(a.strands * 1.9);
  });

  it('só cresce onde há cabelo', () => {
    const q = quad(0, 0);
    expect(buildStrands(q.pos, q.nor, q.idx, q.hair, { density: 40, length: 0.05 }).strands).toBe(0);
    // metade com cabelo: o segundo triângulo (vértices 0, 2, 3) tem peso médio 1/3 -> sem fios abaixo de 0,2? tem
    const m = quad(1, 0);
    const s = buildStrands(m.pos, m.nor, m.idx, m.hair, { density: 40, length: 0.05, seed: 3 });
    const full = buildStrands(quad(1, 1).pos, q.nor, q.idx, quad(1, 1).hair, { density: 40, length: 0.05, seed: 3 });
    expect(s.strands).toBeGreaterThan(0);
    expect(s.strands).toBeLessThan(full.strands);
  });

  it('os fios saem da superfície, têm o comprimento pedido e a gravidade os faz descer', () => {
    const q = quad(1, 1);
    const L = 0.06;
    const s = buildStrands(q.pos, q.nor, q.idx, q.hair, { density: 10, length: L, seed: 1, segments: 6 });
    expect(s.segments).toBe(6);
    expect(s.positions.every(Number.isFinite)).toBe(true);
    let sum = 0, descended = 0;
    for (let i = 0; i < s.strands; i++) {
      const o = i * 6 * 6;
      const root = [s.positions[o]!, s.positions[o + 1]!, s.positions[o + 2]!];
      expect(root[1]).toBeCloseTo(0.1, 5); // a raiz está no plano da superfície
      let len = 0;
      for (let k = 0; k < 6; k++) {
        const p = o + k * 6;
        len += Math.hypot(s.positions[p + 3]! - s.positions[p]!, s.positions[p + 4]! - s.positions[p + 1]!, s.positions[p + 5]! - s.positions[p + 2]!);
      }
      sum += len;
      const endY = s.positions[o + 5 * 6 + 4]!;
      if (endY < 0.1 + 0.9 * L) descended++;
    }
    const mean = sum / s.strands;
    expect(mean).toBeGreaterThan(L * 0.75);
    expect(mean).toBeLessThan(L * 1.25);
    expect(descended).toBe(s.strands); // nenhum fio sobe reto até o comprimento total
  });

  it('cabelo comprido cai junto da cabeça (sem fios soltos para os lados) e as pontas variam de tamanho', () => {
    const q = quad(1, 1);
    const style = { top: 0.3, side: 0.38, back: 0.4, fringe: 0, curl: 0, puff: 0.6, wave: 0.3 };
    const s = buildStrands(q.pos, q.nor, q.idx, q.hair, { density: 30, length: 0.3, seed: 5, segments: 14, style });
    const hx = 0.054; // meia-largura da calota de teste (+ 4 mm)
    let maxX = 0;
    const ends = new Set<number>();
    for (let i = 0; i < s.positions.length; i += 3) maxX = Math.max(maxX, Math.abs(s.positions[i]!));
    for (let i = 0; i < s.strands; i++) ends.add(Math.round(s.positions[(i * 14 + 13) * 6 + 4]! * 200));
    expect(maxX).toBeLessThan(hx * 1.8 + 0.03);
    expect(ends.size).toBeGreaterThan(4); // não terminam todos na mesma altura
  });

  it('lê da foto a direção dos fios e a cor de cada um', () => {
    const w = 64;
    const h = 64;
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const stripe = x % 4 < 2 ? 40 : 120; // listras verticais: os fios correm na vertical
        rgba[i] = stripe;
        rgba[i + 1] = stripe * 0.6;
        rgba[i + 2] = stripe * 0.3;
        rgba[i + 3] = 255;
      }
    }
    const f = orientationField({ rgba, w, h }, 4);
    const c = 32 * w + 32;
    expect(Math.abs(Math.sin(f.angle[c]!))).toBeGreaterThan(0.95);
    expect(f.coherence[c]!).toBeGreaterThan(0.9);

    const q = quad(1, 1);
    const uv = [0, 0, 1, 0, 1, 1, 0, 1];
    const s = buildStrands(q.pos, q.nor, q.idx, q.hair, {
      density: 5,
      length: 0.05,
      seed: 2,
      photo: { rgba, w, h },
      uv,
      base: [0.3, 0.2, 0.1],
    });
    expect(s.colors).toBeDefined();
    expect(s.colors!.length).toBe(s.shade.length * 3);
    expect(s.colors!.every((x) => Number.isFinite(x) && x >= 0 && x <= 1)).toBe(true);
    expect(s.positions.every(Number.isFinite)).toBe(true);
  });

  it('o gerador pseudoaleatório fica em [0, 1) e muda com a semente', () => {
    const r = mulberry32(5);
    for (let i = 0; i < 1000; i++) {
      const x = r();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});
