import { PROCEDURE_PRESETS, SLIDER_MAX_MM, SLIDERS, type SliderId } from '@sim/contracts';
import { describe, expect, it } from 'vitest';
import { isShapeActive, shapeMm, SHAPES } from './procedureShapes';

describe('formatos prontos dos procedimentos', () => {
  it('todo procedimento tem formatos, e cada formato só usa sliders do próprio procedimento', () => {
    for (const p of PROCEDURE_PRESETS) {
      const shapes = SHAPES[p.id];
      expect(shapes?.length, p.id).toBeGreaterThanOrEqual(3);
      for (const sh of shapes!) {
        for (const [id, v] of Object.entries(sh.values)) {
          expect((p.sliders as readonly string[]).includes(id), `${p.id}/${sh.label} usa ${id}`).toBe(true);
          expect(Math.abs(v!)).toBeLessThanOrEqual(0.85); // nenhum formato já nasce no limite
        }
      }
    }
  });

  it('todo slider tem limite em mm e a tabela só tem sliders do contrato', () => {
    for (const s of SLIDERS) expect(SLIDER_MAX_MM[s.id], s.id).toBeGreaterThan(0);
    expect(Object.keys(SLIDER_MAX_MM)).toHaveLength(SLIDERS.length);
  });

  it('detecta o formato aplicado e calcula o deslocamento em mm', () => {
    const lips = SHAPES.lips![2]!; // volumoso
    const ids = PROCEDURE_PRESETS.find((p) => p.id === 'lips')!.sliders;
    expect(isShapeActive(lips, ids, lips.values)).toBe(true);
    expect(isShapeActive(lips, ids, { ...lips.values, 'lips.contour': 0.9 })).toBe(false);
    expect(isShapeActive(lips, ids, {})).toBe(false);
    const mm = shapeMm(lips, (id: SliderId) => SLIDER_MAX_MM[id]);
    expect(mm).toBeCloseTo(0.8 * SLIDER_MAX_MM['lips.lowerVolume'], 5);
  });

  it('os procedimentos novos existem no catálogo e nos sliders', () => {
    const ids = PROCEDURE_PRESETS.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['lips', 'malar', 'chin', 'jaw', 'nose', 'infraorbital', 'nasolabial', 'temple', 'masseter']));
    expect(SLIDERS.map((s) => s.id)).toEqual(expect.arrayContaining(['temple.volume', 'masseter.reduction']));
  });
});
