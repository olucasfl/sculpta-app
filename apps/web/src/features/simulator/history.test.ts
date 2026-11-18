import { describe, expect, it } from 'vitest';
import { apply, commit, emptyHistory, normalize, redo, regionHasChanges, resetRegion, setLive, undo } from './history';

describe('histórico da simulação', () => {
  it('arrastar não cria histórico; soltar cria um passo', () => {
    let h = emptyHistory();
    h = setLive(h, 'lips.upperVolume', 0.1);
    h = setLive(h, 'lips.upperVolume', 0.3);
    expect(h.past).toHaveLength(0);
    h = commit(h);
    expect(h.past).toEqual([{}]);
    expect(h.committed).toEqual({ 'lips.upperVolume': 0.3 });
    expect(commit(h)).toBe(h); // sem mudança, sem passo novo
  });

  it('desfaz e refaz', () => {
    let h = commit(setLive(emptyHistory(), 'chin.projection', 0.5));
    h = commit(setLive(h, 'nose.tipRotation', -0.2));
    h = undo(h);
    expect(h.live).toEqual({ 'chin.projection': 0.5 });
    h = undo(h);
    expect(h.live).toEqual({});
    expect(undo(h)).toBe(h);
    h = redo(redo(h));
    expect(h.live).toEqual({ 'chin.projection': 0.5, 'nose.tipRotation': -0.2 });
    // Nova mudança depois de desfazer descarta o "refazer".
    h = commit(setLive(undo(h), 'jaw.width', 0.1));
    expect(h.future).toHaveLength(0);
  });

  it('respeita o mínimo de cada slider e remove zeros', () => {
    expect(normalize({ 'lips.upperVolume': -0.5, 'chin.height': -0.5, 'jaw.width': 0, 'malar.volume': 2 })).toEqual({
      'chin.height': -0.5,
      'malar.volume': 1,
    });
  });

  it('restaura só a região escolhida', () => {
    let h = apply(emptyHistory(), { 'lips.upperVolume': 0.4, 'lips.contour': 0.2, 'chin.projection': 0.3 });
    expect(regionHasChanges(h.live, 'lips')).toBe(true);
    h = resetRegion(h, 'lips');
    expect(h.live).toEqual({ 'chin.projection': 0.3 });
    expect(regionHasChanges(h.live, 'lips')).toBe(false);
    expect(undo(h).live).toEqual({ 'lips.upperVolume': 0.4, 'lips.contour': 0.2, 'chin.projection': 0.3 });
  });
});
