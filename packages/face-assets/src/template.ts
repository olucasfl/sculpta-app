import { computeNormals, gauss2, keyframes, segmentDistance, smoothstep } from './math.js';

/**
 * Cabeça TEMPLATE procedural, genérica e sem identidade: serve só para demonstrar os
 * controles enquanto não há reconstrução (ADR 0001). Não é o FLAME e não representa
 * nenhum paciente. Unidades internas "u" (cabeça ≈ 2u de altura); exportada em metros.
 *
 * Eixos: y para cima, +z é a frente do rosto, +x é o lado esquerdo do paciente.
 */
export const UNIT_TO_METERS = 0.1;

export interface TemplateMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Quanto cada vértice "olha para frente" (0 nas costas, 1 no rosto). */
  front: Float32Array;
  eyeCenters: [number, number, number][];
  eyeRadius: number;
}

const ROWS_TOP = 34;
const ROWS_FACE = 150;
const ROWS_NECK = 26;
const COLS = 176;

/** Linhas mais densas na região do rosto. */
function rowHeights(): number[] {
  const ys: number[] = [];
  for (let i = 1; i <= ROWS_TOP; i++) ys.push(1.05 - (0.6 * i) / ROWS_TOP);
  for (let i = 1; i <= ROWS_FACE; i++) ys.push(0.45 - (1.47 * i) / ROWS_FACE);
  for (let i = 1; i <= ROWS_NECK; i++) ys.push(-1.02 - (0.73 * i) / ROWS_NECK);
  return ys;
}

/** Colunas mais densas na frente: θ = π·s·(a + (1−a)s²). */
const columnAngle = (j: number) => {
  const s = (2 * j) / COLS - 1;
  return Math.PI * s * (0.38 + 0.62 * s * s);
};

function crossSection(y: number) {
  const s = Math.sqrt(Math.max(0, 1 - (y / 1.05) ** 2));
  const cranium = y >= 0;
  const rx = cranium
    ? 0.78 * s ** 0.85
    : keyframes([[0, 0.78], [-0.3, 0.74], [-0.62, 0.63], [-0.82, 0.46], [-0.95, 0.4], [-1.1, 0.4]], y);
  const rzF = cranium
    ? 0.88 * s
    : keyframes([[0, 0.88], [-0.5, 0.86], [-0.8, 0.78], [-0.9, 0.62], [-1.0, 0.34], [-1.15, 0.36]], y);
  const rzB = cranium ? 0.98 * s : keyframes([[0, 0.98], [-0.45, 0.8], [-0.8, 0.5], [-1.0, 0.42]], y);
  const cz = keyframes([[-0.6, 0], [-1.05, -0.12]], y);
  return { rx, rzF, rzB, cz };
}

/** Relevo do rosto (deslocamento em +z, unidades u). */
export function faceRelief(x: number, y: number): number {
  const ax = Math.abs(x);
  let d = 0;
  // Olhos (órbitas e pálpebras), sobrancelhas, glabela
  d += -0.11 * gauss2(ax, y, 0.3, 0.17, 0.12, 0.07);
  d += 0.035 * gauss2(ax, y, 0.28, 0.32, 0.17, 0.05);
  d += 0.02 * gauss2(x, y, 0, 0.3, 0.08, 0.06);
  // Nariz: dorso que cresce até a ponta, base cortada abaixo da ponta
  const dorsumH = 0.04 + 0.16 * smoothstep(0.25, -0.18, y);
  const dorsumW = 0.045 + 0.035 * smoothstep(0.1, -0.2, y);
  const win = smoothstep(0.3, 0.18, y) * smoothstep(-0.29, -0.2, y);
  d += dorsumH * Math.exp(-(x * x) / (2 * dorsumW * dorsumW)) * win;
  d += 0.04 * gauss2(x, y, 0, -0.19, 0.055, 0.05);
  d += 0.05 * gauss2(ax, y, 0.095, -0.215, 0.045, 0.04);
  d += -0.03 * gauss2(ax, y, 0.05, -0.255, 0.025, 0.015);
  // Maxila e boca
  d += 0.06 * gauss2(x, y, 0, -0.42, 0.22, 0.16);
  d += 0.045 * gauss2(x, y, 0, -0.425, 0.15, 0.03) - 0.008 * gauss2(x, y, 0, -0.405, 0.03, 0.015);
  d += 0.05 * gauss2(x, y, 0, -0.515, 0.13, 0.035);
  d += -0.035 * gauss2(x, y, 0, -0.468, 0.17, 0.009);
  d += -0.02 * gauss2(ax, y, 0.17, -0.47, 0.03, 0.03);
  // Queixo
  d += -0.025 * gauss2(x, y, 0, -0.6, 0.12, 0.03);
  d += 0.07 * gauss2(x, y, 0, -0.74, 0.13, 0.09);
  // Malar e bochechas
  d += 0.05 * gauss2(ax, y, 0.43, 0, 0.13, 0.09);
  d += -0.02 * gauss2(ax, y, 0.42, -0.3, 0.12, 0.12);
  // Sulco lacrimal (infraorbital)
  d += -0.018 * gauss2(ax, y, 0.22, 0.05, 0.09, 0.022);
  // Sulco nasolabial: vinco + leve volume lateral
  const fold = segmentDistance(ax, y, 0.12, -0.26, 0.22, -0.52);
  const outer = segmentDistance(ax - 0.035, y, 0.12, -0.26, 0.22, -0.52);
  d += -0.022 * Math.exp(-fold.d2 / (2 * 0.018 ** 2)) + 0.014 * Math.exp(-outer.d2 / (2 * 0.03 ** 2));
  // Linhas da testa (só para mostrar que a malha tem detalhe; sem slider no MVP)
  for (const yk of [0.52, 0.6, 0.68]) d += -0.006 * Math.exp(-((y - yk) ** 2) / (2 * 0.007 ** 2)) * Math.exp(-(x * x) / (2 * 0.25 ** 2));
  return d;
}

export function buildTemplateHead(): TemplateMesh {
  const ys = rowHeights();
  const pos: number[] = [0, 1.05, 0]; // polo superior
  const front: number[] = [0];
  for (const y of ys) {
    const { rx, rzF, rzB, cz } = crossSection(y);
    for (let j = 0; j < COLS; j++) {
      const th = columnAngle(j);
      const sin = Math.sin(th), cos = Math.cos(th);
      const p = cos >= 0 ? 0.85 : 1;
      const x = rx * Math.sign(sin) * Math.abs(sin) ** p;
      let z = cz + (cos >= 0 ? rzF : rzB) * Math.sign(cos) * Math.abs(cos) ** p;
      const f = smoothstep(0.15, 0.6, cos);
      z += faceRelief(x, y) * f;
      pos.push(x, y, z);
      front.push(f);
    }
  }
  const last = ys[ys.length - 1]!;
  const bottom = crossSection(last);
  pos.push(0, last - 0.02, bottom.cz); // polo inferior (fecha o pescoço)
  front.push(0);

  const idx: number[] = [];
  const ring = (r: number, j: number) => 1 + r * COLS + (j % COLS);
  // Ordem anti-horária vista de fora (normais para fora).
  for (let j = 0; j < COLS; j++) idx.push(0, ring(0, j), ring(0, j + 1));
  for (let r = 0; r < ys.length - 1; r++) {
    for (let j = 0; j < COLS; j++) {
      const a = ring(r, j), b = ring(r, j + 1), c = ring(r + 1, j), d = ring(r + 1, j + 1);
      idx.push(a, c, b, b, c, d);
    }
  }
  const bottomIdx = pos.length / 3 - 1;
  for (let j = 0; j < COLS; j++) idx.push(bottomIdx, ring(ys.length - 1, j + 1), ring(ys.length - 1, j));

  const positions = new Float32Array(pos);
  const indices = new Uint32Array(idx);

  // Globo ocular: aparece ~0,04u à frente do fundo da órbita (medido na própria malha).
  const eyeRadius = 0.085;
  let socketZ = 0;
  let best = Infinity;
  for (let i = 0; i < positions.length / 3; i++) {
    if (front[i]! < 0.5) continue;
    const d = (positions[i * 3]! - 0.3) ** 2 + (positions[i * 3 + 1]! - 0.17) ** 2;
    if (d < best) [best, socketZ] = [d, positions[i * 3 + 2]!];
  }
  const eyeZ = socketZ - eyeRadius + 0.04;

  return {
    positions,
    indices,
    normals: computeNormals(positions, indices),
    front: new Float32Array(front),
    eyeCenters: [
      [-0.3, 0.17, eyeZ],
      [0.3, 0.17, eyeZ],
    ],
    eyeRadius,
  };
}
