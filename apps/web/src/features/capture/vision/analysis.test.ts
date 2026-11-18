import { describe, expect, it } from 'vitest';
import { evaluate, faceBox, fitWithin, laplacianVariance, toGray, yawFromMatrix, YAW_SIGN } from './analysis';

/** Matriz 4x4 column-major de rotação em Y. */
function rotY(deg: number) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  // colunas: [c,0,-s,0], [0,1,0,0], [s,0,c,0], [0,0,0,1]
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

describe('yawFromMatrix', () => {
  it('recupera o ângulo de uma rotação em Y, no referencial do paciente', () => {
    expect(yawFromMatrix(rotY(30))).toBeCloseTo(30 * YAW_SIGN, 5);
    expect(yawFromMatrix(rotY(-90))).toBeCloseTo(-90 * YAW_SIGN, 5);
    expect(yawFromMatrix(rotY(0))).toBeCloseTo(0, 5);
  });
});

describe('faceBox', () => {
  it('calcula altura e centro do rosto', () => {
    const b = faceBox([{ x: 0.4, y: 0.2 }, { x: 0.6, y: 0.8 }, { x: 0.5, y: 0.5 }]);
    expect(b.heightRatio).toBeCloseTo(0.6);
    expect(b.centerX).toBeCloseTo(0.5);
    expect(b.centerY).toBeCloseTo(0.5);
  });
});

describe('nitidez', () => {
  const W = 64, H = 64;
  const checker = new Uint8Array(W * H).map((_, i) => (((i % W) >> 2) + ((i / W) >> 2)) % 2 ? 255 : 0);
  const flat = new Uint8Array(W * H).fill(128);

  it('imagem com bordas tem variância alta; imagem lisa, zero', () => {
    expect(laplacianVariance(checker, W, H)).toBeGreaterThan(1000);
    expect(laplacianVariance(flat, W, H)).toBe(0);
  });

  it('converte RGBA para cinza', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    expect(Array.from(toGray(rgba, 2, 1))).toEqual([255, 0]);
  });
});

describe('fitWithin', () => {
  it('reduz o lado maior para 2048 e não amplia fotos pequenas', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('evaluate', () => {
  const good = { faceDetected: true, yawDeg: 1, faceHeightRatio: 0.55, centerOffset: 0.05, sharpness: 200 };

  it('libera a frontal quando tudo está dentro das regras', () => {
    expect(evaluate('FRONT', good).ready).toBe(true);
  });

  it('bloqueia fora do ângulo e diz para que lado virar', () => {
    const r = evaluate('LEFT_45', good);
    expect(r.ready).toBe(false);
    const angle = r.checks.find((c) => c.id === 'angle')!;
    expect(angle.ok).toBe(false);
    expect(angle.hint).toMatch(/esquerda/);
  });

  it('bloqueia rosto pequeno, descentralizado ou borrado', () => {
    expect(evaluate('FRONT', { ...good, faceHeightRatio: 0.2 }).checks.find((c) => c.id === 'size')?.hint).toMatch(/Aproxime/);
    expect(evaluate('FRONT', { ...good, centerOffset: 0.4 }).ready).toBe(false);
    expect(evaluate('FRONT', { ...good, sharpness: 5 }).ready).toBe(false);
  });

  it('sem rosto no perfil sugere a captura manual', () => {
    const r = evaluate('RIGHT_90', { faceDetected: false, yawDeg: null, faceHeightRatio: null, centerOffset: null, sharpness: 150 });
    expect(r.ready).toBe(false);
    expect(r.checks[0]?.hint).toMatch(/manual/);
  });
});
