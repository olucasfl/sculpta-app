export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Interpolação suave entre `a` e `b` (0 antes de a, 1 depois de b; aceita a > b). */
export function smoothstep(a: number, b: number, x: number) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export const gauss2 = (x: number, y: number, cx: number, cy: number, sx: number, sy: number) =>
  Math.exp(-(((x - cx) ** 2) / (2 * sx * sx) + ((y - cy) ** 2) / (2 * sy * sy)));

/** Interpola valores definidos em alturas-chave (ordem decrescente de y), com transição suave. */
export function keyframes(keys: [number, number][], y: number) {
  if (y >= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const [y1, v1] = keys[i]!;
    const [y0, v0] = keys[i - 1]!;
    if (y >= y1) return v0 + (v1 - v0) * smoothstep(y0, y1, y);
  }
  return keys[keys.length - 1]![1];
}

/**
 * Peso com decaimento suave e suporte compacto: 1 no centro, 0 a partir do raio,
 * derivada contínua na borda (sem degrau na malha).
 */
export function falloff(d2: number) {
  if (d2 >= 1) return 0;
  const t = 1 - d2;
  return t * t;
}

/** Distância ao quadrado de um ponto a um segmento, e o parâmetro t ao longo dele. */
export function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const vx = bx - ax, vy = by - ay;
  const t = clamp01(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy));
  const dx = px - (ax + t * vx), dy = py - (ay + t * vy);
  return { d2: dx * dx + dy * dy, t };
}

/** Normais por vértice (média ponderada pela área dos triângulos). */
export function computeNormals(pos: Float32Array, idx: Uint32Array): Float32Array {
  const n = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]! * 3, b = idx[i + 1]! * 3, c = idx[i + 2]! * 3;
    const e1x = pos[b]! - pos[a]!, e1y = pos[b + 1]! - pos[a + 1]!, e1z = pos[b + 2]! - pos[a + 2]!;
    const e2x = pos[c]! - pos[a]!, e2y = pos[c + 1]! - pos[a + 1]!, e2z = pos[c + 2]! - pos[a + 2]!;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      n[v]! += nx;
      n[v + 1]! += ny;
      n[v + 2]! += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!) || 1;
    n[i]! /= l;
    n[i + 1]! /= l;
    n[i + 2]! /= l;
  }
  return n;
}
