import { describe, expect, it } from 'vitest';
import { isBilateral, pointsLayer, type AppPoint } from './points';

/** Grade 5x5 (z = 0, normais +z), espaçamento 0,01. Vértice (x, y) = y*5 + x. */
function grid() {
  const positions: number[] = [];
  const normals: number[] = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      positions.push((x - 2) * 0.01, (y - 2) * 0.01, 0);
      normals.push(0, 0, 1);
    }
  }
  return { positions, normals };
}

const base: AppPoint = { id: 'a', procedureId: 'lips', regions: ['lips'], pos: [0, 0, 0], mm: 2, radius: 20, mirror: false };
const everywhere = () => new Float32Array(25).fill(1);

describe('pontos de aplicação', () => {
  it('sobe a pele no centro, mais do que na borda, e nunca passa do valor do ponto', () => {
    const { positions, normals } = grid();
    const out = new Float32Array(75);
    pointsLayer(positions, normals, everywhere, [base], out);
    const center = 12;
    expect(out[center * 3 + 2]).toBeGreaterThan(0);
    expect(out[center * 3 + 2]).toBeLessThanOrEqual(0.002 + 1e-9);
    expect(out[center * 3 + 2]).toBeGreaterThan(out[(center + 1) * 3 + 2]!);
  });

  it('só age dentro da zona: peso zero na zona = nenhum efeito', () => {
    const { positions, normals } = grid();
    const out = new Float32Array(75);
    const half = new Float32Array(25);
    half.fill(1, 0, 10); // só as duas primeiras linhas fazem parte da zona
    pointsLayer(positions, normals, () => half, [base], out);
    for (let v = 10; v < 25; v++) expect(out[v * 3 + 2]).toBe(0);
    expect(out[0 * 3 + 2]! + out[6 * 3 + 2]!).toBeGreaterThan(0);
    pointsLayer(positions, normals, () => null, [base], out);
    expect(out.every((x) => x === 0)).toBe(true);
  });

  it('espelha em X e soma pontos', () => {
    const { positions, normals } = grid();
    const out = new Float32Array(75);
    pointsLayer(positions, normals, everywhere, [{ ...base, pos: [-0.02, 0, 0], radius: 12, mirror: true }], out);
    const left = 2 * 5 + 0;
    const right = 2 * 5 + 4;
    expect(out[left * 3 + 2]).toBeGreaterThan(0);
    expect(out[right * 3 + 2]).toBeCloseTo(out[left * 3 + 2]!, 9);
    const one = new Float32Array(75);
    const two = new Float32Array(75);
    pointsLayer(positions, normals, everywhere, [base], one);
    pointsLayer(positions, normals, everywhere, [base, { ...base, id: 'b' }], two);
    expect(two[12 * 3 + 2]).toBeCloseTo(one[12 * 3 + 2]! * 2, 9);
  });

  it('o teto de 3 mm por ponto e o limite da pele valem', () => {
    const { positions, normals } = grid();
    const out = new Float32Array(75);
    pointsLayer(positions, normals, everywhere, [{ ...base, mm: 50 }], out);
    expect(out[12 * 3 + 2]).toBeLessThanOrEqual(0.003 + 1e-9);
    const many = Array.from({ length: 10 }, (_, i) => ({ ...base, id: String(i), mm: 3 }));
    pointsLayer(positions, normals, everywhere, many, out);
    expect(out[12 * 3 + 2]).toBeLessThanOrEqual(0.008 + 1e-9);
  });

  it('procedimentos dos dois lados nascem espelhados; os do centro, não', () => {
    expect(isBilateral(['malar'])).toBe(true);
    expect(isBilateral(['masseter'])).toBe(true);
    expect(isBilateral(['lips'])).toBe(false);
    expect(isBilateral(['chin'])).toBe(false);
  });
});
