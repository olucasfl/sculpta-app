import { describe, expect, it } from 'vitest';
import {
  applyBrush,
  buildSculptMesh,
  decodeOffsets,
  encodeOffsets,
  falloff,
  MAX_OFFSET,
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

const base: BrushParams = { tool: 'push', radius: 0.025, strength: 1, pressure: 1, symmetry: false };
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
    applyBrush(m, pull, [0, 0, 0], { ...base, tool: 'pull' });
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
});
