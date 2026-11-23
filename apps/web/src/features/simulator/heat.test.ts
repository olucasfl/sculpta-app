import { describe, expect, it } from 'vitest';
import { fillHeatColors, HEAT_MAX_MM, heatColor } from './heat';

describe('mapa de alterações', () => {
  it('cinza quando não mudou e vermelho no limite', () => {
    const [r0, g0, b0] = heatColor(0);
    expect(Math.abs(r0 - g0)).toBeLessThan(0.05); // neutro
    expect(Math.abs(g0 - b0)).toBeLessThan(0.05);
    const [r, g, b] = heatColor(HEAT_MAX_MM);
    expect(r).toBeGreaterThan(0.9);
    expect(g).toBeLessThan(0.4);
    expect(b).toBeLessThan(0.4);
    expect(heatColor(100)).toEqual(heatColor(HEAT_MAX_MM)); // acima do limite não passa do vermelho
  });

  it('cresce de azul para vermelho com o deslocamento', () => {
    const low = heatColor(0.5);
    const mid = heatColor(4);
    const high = heatColor(8);
    expect(low[2]).toBeGreaterThan(low[0]); // azulado
    expect(mid[1]).toBeGreaterThan(mid[2]); // esverdeado ou amarelado
    expect(high[0]).toBeGreaterThan(high[2]);
  });

  it('colore cada vértice pelo módulo do deslocamento (m -> mm)', () => {
    const disp = new Float32Array([0, 0, 0, 0, 0, 0.008, 0.003, 0, 0]);
    const out = new Float32Array(9);
    fillHeatColors(disp, out);
    expect(out[0]).toBeCloseTo(heatColor(0)[0], 6);
    expect(out[3]).toBeCloseTo(heatColor(8)[0], 5);
    expect(out[6]).toBeCloseTo(heatColor(3)[0], 5);
  });
});
