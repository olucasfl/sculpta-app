/**
 * Zona de um procedimento: o conjunto de vértices que a região dele cobre (pesos `_REGION_*` do .glb).
 * Serve para enquadrar a câmera na zona ao escolher o procedimento, sem coordenadas escritas à mão: vale para
 * qualquer rosto reconstruído, porque a região vem da própria malha.
 */

export interface Zone {
  center: [number, number, number];
  /** Meia extensão (m) do maior lado da caixa que envolve a zona. */
  radius: number;
  vertices: number;
}

/** `weights`: um array de pesos por região (0 a 1 por vértice); vale o maior peso entre as regiões. */
export function zoneBounds(positions: ArrayLike<number>, weights: ArrayLike<number>[], threshold = 0.35): Zone | null {
  const n = positions.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let count = 0;
  for (let v = 0; v < n; v++) {
    let w = 0;
    for (const a of weights) w = Math.max(w, a[v] ?? 0);
    if (w < threshold) continue;
    count++;
    for (let k = 0; k < 3; k++) {
      const p = positions[v * 3 + k]!;
      if (p < min[k]!) min[k] = p;
      if (p > max[k]!) max[k] = p;
    }
  }
  if (count < 3) return null;
  const center: [number, number, number] = [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2];
  // a câmera olha de frente na maior parte do tempo: o que importa é a extensão em x e y
  const radius = Math.max((max[0]! - min[0]!) / 2, (max[1]! - min[1]!) / 2);
  return { center, radius, vertices: count };
}

/** Distância da câmera (m) que enquadra a zona com folga (fov de 30 graus), entre `min` e `max`. */
export function distanceForZone(radius: number, min = 0.26, max = 0.62): number {
  const fit = (2 * radius * 1.8) / (2 * Math.tan((15 * Math.PI) / 180));
  return Math.max(min, Math.min(max, fit));
}
