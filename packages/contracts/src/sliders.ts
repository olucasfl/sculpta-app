import { z } from 'zod';

/**
 * Contrato v1 dos sliders (planejamento §6). Sem unidade, de -1 a 1.
 * O deslocamento máximo de cada um fica em `sliders.json` (Fase 3) e é visual, nunca dose ou volume de produto.
 */
export const SLIDER_SCHEMA_VERSION = 1;

export const SLIDERS = [
  { id: 'nose.bridgeWidth', region: 'nose', label: 'Largura do dorso', min: -1 },
  { id: 'nose.dorsumHeight', region: 'nose', label: 'Perfil do dorso', min: -1 },
  { id: 'nose.tipProjection', region: 'nose', label: 'Projeção da ponta', min: -1 },
  { id: 'nose.tipRotation', region: 'nose', label: 'Rotação da ponta', min: -1 },
  { id: 'nose.alarWidth', region: 'nose', label: 'Largura das asas', min: -1 },
  { id: 'lips.upperVolume', region: 'lips', label: 'Volume do lábio superior', min: 0 },
  { id: 'lips.lowerVolume', region: 'lips', label: 'Volume do lábio inferior', min: 0 },
  { id: 'lips.contour', region: 'lips', label: 'Definição do contorno', min: 0 },
  { id: 'chin.projection', region: 'chin', label: 'Projeção do mento', min: -1 },
  { id: 'chin.height', region: 'chin', label: 'Altura do mento', min: -1 },
  { id: 'jaw.width', region: 'jaw', label: 'Definição mandibular', min: -1 },
  { id: 'malar.volume', region: 'malar', label: 'Volume malar', min: 0 },
  { id: 'malar.projection', region: 'malar', label: 'Projeção malar', min: 0 },
  { id: 'infraorbital.volume', region: 'infraorbital', label: 'Suavização infraorbital', min: 0 },
  { id: 'nasolabial.volume', region: 'nasolabial', label: 'Suavização do sulco nasolabial', min: 0 },
] as const;

/** Mínimo exibido na interface: volumes só somam (0 a 1); contornos vão de -1 a 1. */
export type SliderId = (typeof SLIDERS)[number]['id'];
export type FaceRegion = (typeof SLIDERS)[number]['region'];

export const SliderValue = z.number().min(-1).max(1);

const sliderIds = SLIDERS.map((s) => s.id) as [SliderId, ...SliderId[]];

/** Parâmetros de uma versão de simulação. Ausente = 0. */
export const SimulationParams = z.partialRecord(z.enum(sliderIds), SliderValue);
export type SimulationParams = z.infer<typeof SimulationParams>;
