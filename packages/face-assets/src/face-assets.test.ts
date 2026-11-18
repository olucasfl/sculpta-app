import { SLIDERS } from '@sim/contracts';
import { describe, expect, it } from 'vitest';
import { buildSliderBases, buildTemplateGlb, buildTemplateHead, readGlbJson, regionWeights, REGION_ORDER } from './index.js';

const mesh = buildTemplateHead();
const bases = buildSliderBases(mesh);
const n = mesh.positions.length / 3;

function vertexNear(x: number, y: number) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < n; i++) {
    if (mesh.front[i]! < 0.9) continue;
    const d = (mesh.positions[i * 3]! - x) ** 2 + (mesh.positions[i * 3 + 1]! - y) ** 2;
    if (d < bd) [bd, best] = [d, i];
  }
  return best;
}

describe('template', () => {
  it('é uma malha fechada, com normais para fora', () => {
    expect(n).toBeGreaterThan(20_000);
    expect(mesh.indices.length % 3).toBe(0);
    expect(mesh.indices.reduce((m, v) => Math.max(m, v), 0)).toBe(n - 1);
    const tip = vertexNear(0, -0.19);
    expect(mesh.normals[tip * 3 + 2]).toBeGreaterThan(0.5); // ponta do nariz aponta para frente (+z)
    const back = mesh.positions.findIndex((_, i) => i % 3 === 2 && mesh.positions[i]! < -0.9);
    expect(mesh.normals[back]).toBeLessThan(0); // nuca aponta para trás
  });

  it('o nariz é o ponto mais à frente do rosto', () => {
    const tip = vertexNear(0, -0.19);
    const cheek = vertexNear(0.4, -0.2);
    expect(mesh.positions[tip * 3 + 2]!).toBeGreaterThan(mesh.positions[cheek * 3 + 2]! + 0.1);
  });
});

describe('regiões', () => {
  it('pesos ficam entre 0 e 1, são simétricos e zeram nas costas', () => {
    for (const [x, y] of [[0.1, -0.3], [0.4, 0], [0.5, -0.6]] as const) {
      const a = regionWeights(x, y, 1);
      const b = regionWeights(-x, y, 1);
      for (const r of REGION_ORDER) {
        expect(a[r]).toBeGreaterThanOrEqual(0);
        expect(a[r]).toBeLessThanOrEqual(1);
        expect(a[r]).toBeCloseTo(b[r], 6);
      }
    }
    const back = regionWeights(0, -0.47, 0);
    expect(REGION_ORDER.every((r) => back[r] === 0 || r === 'jaw')).toBe(true);
  });

  it('cada região domina no próprio centro', () => {
    expect(regionWeights(0, -0.02, 1).nose).toBeCloseTo(1, 1);
    expect(regionWeights(0, -0.47, 1).lips).toBeCloseTo(1, 1);
    expect(regionWeights(0, -0.47, 1).nose).toBe(0);
    expect(regionWeights(0, -0.77, 1).chin).toBeCloseTo(1, 1);
  });
});

describe('bases dos sliders', () => {
  it('existe uma base por slider do contrato, e cada uma só mexe na própria região', () => {
    expect(bases.targets.map((t) => t.id)).toEqual(SLIDERS.map((s) => s.id));
    const forehead = vertexNear(0, 0.6);
    const ear = vertexNear(0.7, 0.1);
    for (const t of bases.targets) {
      const moved = t.positions.some((v) => v !== 0);
      expect(moved, t.id).toBe(true);
      for (const v of [forehead, ear]) {
        expect(Math.hypot(t.positions[v * 3]!, t.positions[v * 3 + 1]!, t.positions[v * 3 + 2]!), `${t.id} na testa/orelha`).toBe(0);
      }
    }
  });

  it('projeção do mento move o queixo para frente, sem mexer nos lábios', () => {
    const t = bases.targets.find((x) => x.id === 'chin.projection')!;
    const chin = vertexNear(0, -0.77);
    const lip = vertexNear(0, -0.43);
    expect(t.positions[chin * 3 + 2]!).toBeGreaterThan(0.05);
    expect(t.positions[lip * 3 + 2]!).toBe(0);
  });

  it('largura do dorso é simétrica e não move o centro', () => {
    const t = bases.targets.find((x) => x.id === 'nose.bridgeWidth')!;
    const l = vertexNear(0.04, 0.03), r = vertexNear(-0.04, 0.03);
    expect(t.positions[l * 3]!).toBeGreaterThan(0);
    expect(t.positions[l * 3]!).toBeCloseTo(-t.positions[r * 3]!, 2);
  });
});

describe('glb', () => {
  it('gera um glTF 2.0 válido com morph targets esparsos e nomes', () => {
    const glb = buildTemplateGlb();
    expect(glb.byteLength % 4).toBe(0);
    expect(glb.byteLength).toBeLessThan(4 * 1024 * 1024);
    const json = readGlbJson(glb) as {
      meshes: { extras: { targetNames: string[]; kind: string }; primitives: { targets: unknown[]; attributes: Record<string, number> }[] }[];
      accessors: { sparse?: { count: number } }[];
    };
    const m = json.meshes[0]!;
    expect(m.extras.kind).toBe('TEMPLATE');
    expect(m.extras.targetNames).toEqual(SLIDERS.map((s) => s.id));
    expect(m.primitives[0]!.targets).toHaveLength(SLIDERS.length);
    expect(Object.keys(m.primitives[0]!.attributes)).toContain('_REGION_NOSE');
    expect(json.accessors.filter((a) => a.sparse).length).toBeGreaterThanOrEqual(SLIDERS.length);
  });
});
