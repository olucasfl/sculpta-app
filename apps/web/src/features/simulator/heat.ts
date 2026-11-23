/**
 * Mapa de alterações: cor de cada ponto da pele pelo quanto ele saiu do lugar (mm), somando sliders, pincel e pontos.
 * Cinza = não mudou; azul-claro = pouco; verde, amarelo e vermelho = cada vez mais, até o limite (HEAT_MAX_MM).
 */
export const HEAT_MAX_MM = 8;

const STOPS: [number, [number, number, number]][] = [
  [0, [0.56, 0.72, 1.0]],
  [0.35, [0.24, 0.81, 0.56]],
  [0.65, [1.0, 0.82, 0.25]],
  [1, [1.0, 0.3, 0.3]],
];
const GREY: [number, number, number] = [0.86, 0.86, 0.84];

export function heatColor(mm: number): [number, number, number] {
  if (mm < 0.05) return GREY; // abaixo de 0,05 mm conta como "não mudou"
  const t = Math.min(1, mm / HEAT_MAX_MM);
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i]!;
    const [t0, c0] = STOPS[i - 1]!;
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return STOPS[STOPS.length - 1]![1];
}

/** `disp`: deslocamento por vértice (3 floats, em m). Preenche `out` (3 floats por vértice, 0 a 1). */
export function fillHeatColors(disp: ArrayLike<number>, out: Float32Array): void {
  const n = out.length / 3;
  for (let v = 0; v < n; v++) {
    const mm = Math.hypot(disp[v * 3]!, disp[v * 3 + 1]!, disp[v * 3 + 2]!) * 1000;
    const [r, g, b] = heatColor(mm);
    out[v * 3] = r;
    out[v * 3 + 1] = g;
    out[v * 3 + 2] = b;
  }
}
