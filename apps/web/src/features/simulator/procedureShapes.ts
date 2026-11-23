import type { SliderId } from '@sim/contracts';

/**
 * Formatos prontos de cada procedimento: combinações de sliders (de 0 a 1 do limite da simulação) para começar
 * de um ponto razoável. São configuração de INTERFACE, não indicação clínica nem dose: os valores só dizem "quanto
 * do limite visual" de cada controle.
 */
export interface Shape {
  id: string;
  label: string;
  values: Partial<Record<SliderId, number>>;
}

const level = (id: SliderId, name: string, v: number): Shape => ({ id: `${id}-${v}`, label: name, values: { [id]: v } });
const levels = (id: SliderId): Shape[] => [level(id, 'Sutil', 0.25), level(id, 'Moderado', 0.5), level(id, 'Marcado', 0.8)];

export const SHAPES: Record<string, Shape[]> = {
  lips: [
    { id: 'natural', label: 'Natural', values: { 'lips.upperVolume': 0.3, 'lips.lowerVolume': 0.4, 'lips.contour': 0.2 } },
    { id: 'defined', label: 'Definido', values: { 'lips.upperVolume': 0.35, 'lips.lowerVolume': 0.35, 'lips.contour': 0.7 } },
    { id: 'full', label: 'Volumoso', values: { 'lips.upperVolume': 0.7, 'lips.lowerVolume': 0.8, 'lips.contour': 0.3 } },
  ],
  malar: [
    { id: 'subtle', label: 'Sutil', values: { 'malar.volume': 0.25, 'malar.projection': 0.2 } },
    { id: 'moderate', label: 'Moderado', values: { 'malar.volume': 0.5, 'malar.projection': 0.45 } },
    { id: 'marked', label: 'Marcado', values: { 'malar.volume': 0.8, 'malar.projection': 0.7 } },
  ],
  chin: [
    ...levels('chin.projection'),
    { id: 'longer', label: 'Alongar', values: { 'chin.height': 0.4 } },
  ],
  jaw: levels('jaw.width'),
  nose: [
    { id: 'dorsum', label: 'Dorso mais alto', values: { 'nose.dorsumHeight': 0.4 } },
    { id: 'tip', label: 'Ponta mais projetada', values: { 'nose.tipProjection': 0.4 } },
    { id: 'lift', label: 'Ponta levantada', values: { 'nose.tipRotation': 0.4, 'nose.tipProjection': 0.2 } },
  ],
  infraorbital: levels('infraorbital.volume'),
  nasolabial: levels('nasolabial.volume'),
  temple: levels('temple.volume'),
  masseter: levels('masseter.reduction'),
};

const same = (a: number, b: number) => Math.abs(a - b) < 0.03;

/** O formato está aplicado se os sliders do procedimento batem com ele (e os demais estão em zero). */
export function isShapeActive(shape: Shape, sliderIds: readonly SliderId[], live: Partial<Record<SliderId, number>>): boolean {
  return sliderIds.every((id) => same(live[id] ?? 0, shape.values[id] ?? 0));
}

/** Maior deslocamento do formato, em mm, dado o limite em mm de cada slider. */
export function shapeMm(shape: Shape, maxMm: (id: SliderId) => number): number {
  return Math.max(0, ...Object.entries(shape.values).map(([id, v]) => Math.abs(v ?? 0) * maxMm(id as SliderId)));
}
