import type { FaceRegion } from '@sim/contracts';
import { falloff, MAX_OFFSET } from './sculpt';

/**
 * Pontos de aplicação: o profissional marca onde o procedimento é feito (como os pontos de injeção) e define quanto
 * (mm no centro) e o alcance (raio). Cada ponto vira um volume suave ao longo da normal da pele, SÓ dentro da zona do
 * procedimento (os pesos `_REGION_*` multiplicam o efeito, então nada vaza para fora da área destacada).
 */
export interface AppPoint {
  id: string;
  procedureId: string;
  regions: FaceRegion[];
  /** Posição no rosto (coordenadas do modelo, m). */
  pos: [number, number, number];
  /** Quanto a pele sobe no centro, em mm. */
  mm: number;
  /** Alcance, em mm. */
  radius: number;
  /** Repete o ponto espelhado em X (procedimentos dos dois lados do rosto). */
  mirror: boolean;
}

export const POINT_MM_MAX = 3;
export const POINT_RADIUS_MM = { min: 4, max: 20 };

/** Regiões que existem dos dois lados do rosto (o ponto nasce espelhado). */
const BILATERAL: FaceRegion[] = ['malar', 'jaw', 'infraorbital', 'nasolabial', 'temple', 'masseter'];
export const isBilateral = (regions: FaceRegion[]) => regions.some((r) => BILATERAL.includes(r));

/**
 * Soma o efeito de todos os pontos em `out` (3 floats por vértice, em m). `zone(point)` devolve os pesos da zona do
 * ponto (0 a 1 por vértice) ou null se a zona não existir neste modelo (o ponto não faz nada).
 */
export function pointsLayer(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  zone: (p: AppPoint) => ArrayLike<number> | null,
  points: readonly AppPoint[],
  out: Float32Array,
): void {
  out.fill(0);
  const n = positions.length / 3;
  for (const p of points) {
    const w = zone(p);
    if (!w || p.mm <= 0) continue;
    const r = (Math.max(POINT_RADIUS_MM.min, p.radius) / 1000) || 0.01;
    const amount = Math.min(POINT_MM_MAX, p.mm) / 1000;
    const centers: [number, number, number][] = [p.pos];
    if (p.mirror) centers.push([-p.pos[0], p.pos[1], p.pos[2]]);
    for (const c of centers) {
      for (let v = 0; v < n; v++) {
        const zw = w[v] ?? 0;
        if (zw <= 0) continue;
        const dx = positions[v * 3]! - c[0];
        const dy = positions[v * 3 + 1]! - c[1];
        const dz = positions[v * 3 + 2]! - c[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r) continue;
        const k = falloff(Math.sqrt(d2), r) * Math.min(1, zw * 1.5) * amount;
        out[v * 3] = out[v * 3]! + normals[v * 3]! * k;
        out[v * 3 + 1] = out[v * 3 + 1]! + normals[v * 3 + 1]! * k;
        out[v * 3 + 2] = out[v * 3 + 2]! + normals[v * 3 + 2]! * k;
      }
    }
  }
  // o teto por ponto da pele vale também aqui
  for (let v = 0; v < n; v++) {
    const x = out[v * 3]!, y = out[v * 3 + 1]!, z = out[v * 3 + 2]!;
    const len = Math.hypot(x, y, z);
    if (len > MAX_OFFSET) {
      const k = MAX_OFFSET / len;
      out[v * 3] = x * k;
      out[v * 3 + 1] = y * k;
      out[v * 3 + 2] = z * k;
    }
  }
}

let counter = 0;
export const newPointId = () => `pt-${Date.now().toString(36)}-${(counter++).toString(36)}`;
