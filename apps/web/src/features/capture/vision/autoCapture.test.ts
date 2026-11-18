import { describe, expect, it } from 'vitest';
import { evaluate, pitchFromMatrix, type FrameAnalysis } from './analysis';
import { initialStability, pickFrames, stepStability, STABLE_MS, type VideoSample } from './autoCapture';

const frame = (over: Partial<FrameAnalysis> = {}): FrameAnalysis => ({
  faceDetected: true,
  yawDeg: 0,
  pitchDeg: 0,
  faceHeightRatio: 0.55,
  centerOffset: 0.02,
  sharpness: 120,
  ...over,
});

describe('foto automática', () => {
  it('só dispara depois de 1 s estável e zera ao sair da pose', () => {
    let st = initialStability();
    let r = stepStability(st, 0, true, 100);
    expect(r.progress).toBe(0);
    st = r.state;
    r = stepStability(st, STABLE_MS / 2, true, 100);
    expect(r.progress).toBeCloseTo(0.5);
    expect(r.fire).toBe(false);
    st = r.state;
    // saiu da pose: recomeça
    r = stepStability(st, STABLE_MS / 2 + 100, false, 100);
    expect(r.progress).toBe(0);
    st = r.state;
    r = stepStability(st, 2000, true, 100);
    st = r.state;
    r = stepStability(st, 2000 + STABLE_MS, true, 100);
    expect(r.fire).toBe(true);
  });

  it('espera um quadro nítido: não dispara num quadro tremido', () => {
    let st = initialStability();
    st = stepStability(st, 0, true, 200).state;
    const blurry = stepStability(st, STABLE_MS, true, 80);
    expect(blurry.progress).toBe(1);
    expect(blurry.fire).toBe(false);
    const sharp = stepStability(blurry.state, STABLE_MS + 100, true, 190);
    expect(sharp.fire).toBe(true);
  });
});

describe('inclinação (queixo)', () => {
  it('reconhece queixo para cima/baixo só dentro da faixa e dá dica do sentido', () => {
    expect(evaluate('CHIN_UP', frame({ pitchDeg: 22 })).ready).toBe(true);
    const low = evaluate('CHIN_UP', frame({ pitchDeg: 5 }));
    expect(low.ready).toBe(false);
    expect(low.checks.find((c) => c.id === 'pitch')?.hint).toMatch(/Levante/);
    expect(evaluate('CHIN_DOWN', frame({ pitchDeg: -22 })).ready).toBe(true);
    expect(evaluate('CHIN_DOWN', frame({ pitchDeg: -2 })).checks.find((c) => c.id === 'pitch')?.hint).toMatch(/Abaixe/);
    expect(evaluate('CHIN_UP', frame({ pitchDeg: null })).ready).toBe(false);
  });

  it('vistas de 20° exigem o yaw certo', () => {
    expect(evaluate('LEFT_20', frame({ yawDeg: 20 })).ready).toBe(true);
    expect(evaluate('LEFT_20', frame({ yawDeg: 0 })).ready).toBe(false);
    expect(evaluate('RIGHT_20', frame({ yawDeg: -18 })).ready).toBe(true);
  });

  it('pitch vem da matriz (rotação em X)', () => {
    const a = (25 * Math.PI) / 180;
    // column-major: R(1,2) = m[9]
    const m = new Array(16).fill(0);
    m[0] = 1; m[5] = Math.cos(a); m[6] = Math.sin(a); m[9] = -Math.sin(a); m[10] = Math.cos(a); m[15] = 1;
    expect(pitchFromMatrix(m)).toBeCloseTo(25, 3);
  });
});

describe('vídeo: melhor quadro por vista', () => {
  const s = (t: number, over: Partial<FrameAnalysis>): VideoSample => ({ t, analysis: frame(over) });
  it('escolhe o quadro mais nítido e grande de cada vista, sem repetir quadro', () => {
    const samples = [
      s(0, { yawDeg: 1, sharpness: 90 }),
      s(1, { yawDeg: 2, sharpness: 150 }),
      s(2, { yawDeg: 20, sharpness: 100 }),
      s(3, { yawDeg: 45, sharpness: 110 }),
      s(4, { yawDeg: 44, sharpness: 160 }),
      s(5, { yawDeg: 0, pitchDeg: 24, sharpness: 130 }),
    ];
    const r = pickFrames(samples, ['FRONT', 'LEFT_20', 'LEFT_45', 'CHIN_UP', 'RIGHT_45']);
    expect(r.get('FRONT')?.t).toBe(1);
    expect(r.get('LEFT_20')?.t).toBe(2);
    expect(r.get('LEFT_45')?.t).toBe(4);
    expect(r.get('CHIN_UP')?.t).toBe(5);
    expect(r.has('RIGHT_45')).toBe(false);
  });
});
