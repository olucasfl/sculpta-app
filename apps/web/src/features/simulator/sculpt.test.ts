import { describe, expect, it } from 'vitest';
import {
  applyBrush,
  buildSculptMesh,
  decodeOffsets,
  encodeOffsets,
  falloff,
  MAX_OFFSET,
  STROKE_DEPTH,
  StrokeHistory,
  updateNormalDeltas,
  type BrushParams,
} from './sculpt';

/** Grade 5x5 no plano XY (z = 0), normais para +z. Vértice (x, y) tem índice y*5 + x; espaçamento 0,01. */
function grid() {
  const w = 5;
  const positions = new Float32Array(w * w * 3);
  const normals = new Float32Array(w * w * 3);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const v = y * w + x;
      positions.set([(x - 2) * 0.01, (y - 2) * 0.01, 0], v * 3);
      normals.set([0, 0, 1], v * 3);
    }
  }
  const indices: number[] = [];
  for (let y = 0; y < w - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const a = y * w + x, b = a + 1, c = a + w, d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }
  return buildSculptMesh(positions, normals, indices);
}

const base: BrushParams = { tool: 'add', radius: 0.025, strength: 1, pressure: 1, symmetry: false };
const center = 12; // (2,2)

describe('pincel de escultura', () => {
  it('falloff vai de 1 no centro a 0 na borda', () => {
    expect(falloff(0, 1)).toBe(1);
    expect(falloff(1, 1)).toBe(0);
    expect(falloff(0.5, 1)).toBeGreaterThan(0);
    expect(falloff(0.5, 1)).toBeLessThan(1);
  });

  it('empurrar move os vértices ao longo da normal, mais forte no centro; puxar faz o contrário', () => {
    const m = grid();
    const off = new Float32Array(25 * 3);
    const changed = applyBrush(m, off, [0, 0, 0], base);
    expect(changed).toContain(center);
    expect(off[center * 3 + 2]).toBeGreaterThan(0);
    expect(off[center * 3 + 2]).toBeGreaterThan(off[(center + 1) * 3 + 2]!);
    expect(off[center * 3]).toBe(0); // normal é +z: x e y não mudam
    const pull = new Float32Array(25 * 3);
    applyBrush(m, pull, [0, 0, 0], { ...base, tool: 'reduce' });
    expect(pull[center * 3 + 2]).toBeLessThan(0);
  });

  it('a pressão da caneta escala a força', () => {
    const m = grid();
    const soft = new Float32Array(75);
    const hard = new Float32Array(75);
    applyBrush(m, soft, [0, 0, 0], { ...base, pressure: 0.25 });
    applyBrush(m, hard, [0, 0, 0], { ...base, pressure: 1 });
    expect(hard[center * 3 + 2]! / soft[center * 3 + 2]!).toBeCloseTo(4, 3);
  });

  it('nunca passa do deslocamento máximo, mesmo com muitos toques', () => {
    const m = grid();
    const off = new Float32Array(75);
    for (let k = 0; k < 500; k++) applyBrush(m, off, [0, 0, 0], base);
    expect(off[center * 3 + 2]).toBeLessThanOrEqual(MAX_OFFSET + 1e-9);
  });

  it('simetria em X espelha o toque', () => {
    const m = grid();
    const off = new Float32Array(75);
    applyBrush(m, off, [-0.02, 0, 0], { ...base, symmetry: true, radius: 0.012 });
    const left = 2 * 5 + 0; // x = -0,02
    const right = 2 * 5 + 4; // x = +0,02
    expect(off[left * 3 + 2]).toBeGreaterThan(0);
    expect(off[right * 3 + 2]).toBeCloseTo(off[left * 3 + 2]!, 9);
    const noSym = new Float32Array(75);
    applyBrush(m, noSym, [-0.02, 0, 0], { ...base, symmetry: false, radius: 0.012 });
    expect(noSym[right * 3 + 2]).toBe(0);
  });

  it('borracha reduz o que foi modelado; suavizar aproxima de vizinhos', () => {
    const m = grid();
    const off = new Float32Array(75);
    applyBrush(m, off, [0, 0, 0], base);
    const before = off[center * 3 + 2]!;
    applyBrush(m, off, [0, 0, 0], { ...base, tool: 'erase' });
    expect(off[center * 3 + 2]).toBeLessThan(before);

    const sm = new Float32Array(75);
    sm[center * 3 + 2] = 0.01; // um pico isolado
    applyBrush(m, sm, [0, 0, 0], { ...base, tool: 'smooth' });
    expect(sm[center * 3 + 2]).toBeLessThan(0.01);
    expect(sm[(center + 1) * 3 + 2]).toBeGreaterThan(0);
  });

  it('deltas de normal só mudam onde a superfície mudou', () => {
    const m = grid();
    const off = new Float32Array(75);
    const nd = new Float32Array(75);
    const changed = applyBrush(m, off, [0, 0, 0], { ...base, radius: 0.012 });
    const touched = updateNormalDeltas(m, off, nd, changed);
    expect(touched.length).toBeGreaterThan(changed.length - 1);
    const far = 0; // canto, fora do raio e dos vizinhos
    expect(nd[far * 3]).toBe(0);
    expect(nd[far * 3 + 2]).toBe(0);
  });

  it('desfazer e refazer por traço', () => {
    const m = grid();
    const off = new Float32Array(75);
    const h = new StrokeHistory();
    // traço 1: dois toques
    for (let k = 0; k < 2; k++) {
      h.touch(off, [center, center + 1]);
      applyBrush(m, off, [0, 0, 0], base);
    }
    h.endStroke();
    const after = off[center * 3 + 2]!;
    expect(after).toBeGreaterThan(0);
    expect(h.canUndo).toBe(true);
    h.undo(off);
    expect(off[center * 3 + 2]).toBe(0);
    expect(h.canRedo).toBe(true);
    h.redo(off);
    expect(off[center * 3 + 2]).toBeCloseTo(after, 9);
  });

  it('salvar e carregar: esparso, quantizado e confere a malha', () => {
    const m = grid();
    const off = new Float32Array(75);
    applyBrush(m, off, [0, 0, 0], base);
    const data = encodeOffsets(off)!;
    expect(data.n).toBe(25);
    const back = decodeOffsets(data, 25);
    for (let k = 0; k < off.length; k++) expect(back[k]).toBeCloseTo(off[k]!, 5);
    // Nada modelado: não grava nada.
    expect(encodeOffsets(new Float32Array(75))).toBeNull();
    // Malha de outro tamanho ou dado corrompido: recusa.
    expect(() => decodeOffsets(data, 26)).toThrow();
    expect(() => decodeOffsets({ ...data, d: data.d.slice(0, 4) }, 25)).toThrow();
  });

  it('adicionar volume sobe a pele (para fora) e reduzir afunda (para dentro)', () => {
    const m = grid(); // normais para +z = para fora
    const up = new Float32Array(75);
    const down = new Float32Array(75);
    applyBrush(m, up, [0, 0, 0], { ...base, tool: 'add' });
    applyBrush(m, down, [0, 0, 0], { ...base, tool: 'reduce' });
    expect(up[center * 3 + 2]).toBeGreaterThan(0);
    expect(down[center * 3 + 2]).toBeLessThan(0);
  });

  it('um traço tem teto: muitos toques no mesmo ponto não passam da profundidade do traço', () => {
    const m = grid();
    const off = new Float32Array(75);
    const stroke = new Float32Array(25);
    const params = { ...base, strength: 0.5 };
    for (let k = 0; k < 200; k++) applyBrush(m, off, [0, 0, 0], params, undefined, stroke);
    const cap = STROKE_DEPTH * 0.5;
    expect(off[center * 3 + 2]).toBeLessThanOrEqual(cap + 1e-9);
    expect(off[center * 3 + 2]).toBeGreaterThan(cap * 0.95); // chega perto do teto
  });

  it('um novo traço soma ao anterior (para ir além é só passar de novo)', () => {
    const m = grid();
    const off = new Float32Array(75);
    const params = { ...base, strength: 0.5 };
    let stroke = new Float32Array(25);
    for (let k = 0; k < 50; k++) applyBrush(m, off, [0, 0, 0], params, undefined, stroke);
    const first = off[center * 3 + 2]!;
    stroke = new Float32Array(25); // soltou o mouse
    for (let k = 0; k < 50; k++) applyBrush(m, off, [0, 0, 0], params, undefined, stroke);
    expect(off[center * 3 + 2]).toBeGreaterThan(first * 1.8);
  });

  it('o teto vale para o mínimo: força mínima move menos de 0,2 mm', () => {
    const m = grid();
    const off = new Float32Array(75);
    const stroke = new Float32Array(25);
    for (let k = 0; k < 100; k++) applyBrush(m, off, [0, 0, 0], { ...base, strength: 0.03 }, undefined, stroke);
    expect(off[center * 3 + 2]).toBeLessThan(0.0002);
  });

  it('preso à zona: fora dela nada muda, dentro o peso da zona suaviza a borda', () => {
    const m = grid();
    const zone = new Float32Array(25); // só a coluna x = 0..1 (índices 2 e 3 de cada linha) faz parte da zona
    for (let y = 0; y < 5; y++) {
      zone[y * 5 + 2] = 1;
      zone[y * 5 + 3] = 0.2;
    }
    const off = new Float32Array(75);
    const changed = applyBrush(m, off, [0, 0, 0], { ...base, radius: 0.05 }, undefined, undefined, zone);
    expect(changed.length).toBeGreaterThan(0);
    for (let y = 0; y < 5; y++) {
      expect(off[(y * 5 + 0) * 3 + 2], `x=-2 fora da zona (linha ${y})`).toBe(0);
      expect(off[(y * 5 + 1) * 3 + 2]).toBe(0);
      expect(off[(y * 5 + 4) * 3 + 2]).toBe(0);
    }
    expect(off[12 * 3 + 2]).toBeGreaterThan(off[13 * 3 + 2]!); // centro da zona > borda da zona
    expect(off[13 * 3 + 2]).toBeGreaterThan(0);
  });

  it('a borracha apaga em qualquer lugar, mesmo fora da zona', () => {
    const m = grid();
    const off = new Float32Array(75);
    applyBrush(m, off, [0, 0, 0], { ...base, radius: 0.05 }); // modelou sem zona
    const before = off[10 * 3 + 2]!; // x = -2, y = 0
    expect(before).toBeGreaterThan(0);
    const zone = new Float32Array(25); // zona vazia
    applyBrush(m, off, [0, 0, 0], { ...base, radius: 0.05, tool: 'erase' }, undefined, undefined, zone);
    expect(off[10 * 3 + 2]).toBeLessThan(before);
    const stay = new Float32Array(75);
    applyBrush(m, stay, [0, 0, 0], { ...base, radius: 0.05 }, undefined, undefined, zone);
    expect(stay.every((x) => x === 0)).toBe(true); // adicionar com a zona vazia não faz nada
  });
});
