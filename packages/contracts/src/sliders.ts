import { z } from 'zod';

/**
 * Contrato v1 dos sliders (planejamento §6). Sem unidade, de -1 a 1.
 * O deslocamento máximo de cada um fica em `sliders.json` (Fase 3) e é visual, nunca dose ou volume de produto.
 */
export const SLIDER_SCHEMA_VERSION = 2;

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
  { id: 'temple.volume', region: 'temple', label: 'Volume da têmpora', min: 0 },
  { id: 'masseter.reduction', region: 'masseter', label: 'Redução do masseter', min: 0 },
] as const;

/** Mínimo exibido na interface: volumes só somam (0 a 1); contornos vão de -1 a 1. */
export type SliderId = (typeof SLIDERS)[number]['id'];
export type FaceRegion = (typeof SLIDERS)[number]['region'];

/**
 * Deslocamento máximo (mm, valor do slider = 1) de um rosto médio: serve de reserva para modelos sem a medida própria
 * (o worker grava a medida real de cada rosto em `sliderMaxMm`). É do MODELO, aproximado, e não indica dose.
 */
export const SLIDER_MAX_MM: Record<SliderId, number> = {
  'nose.bridgeWidth': 0.9,
  'nose.dorsumHeight': 3.5,
  'nose.tipProjection': 5.2,
  'nose.tipRotation': 3.7,
  'nose.alarWidth': 4.8,
  'lips.upperVolume': 3.2,
  'lips.lowerVolume': 3.2,
  'lips.contour': 0.5,
  'chin.projection': 7.4,
  'chin.height': 5.1,
  'jaw.width': 4.7,
  'malar.volume': 3.7,
  'malar.projection': 4.2,
  'infraorbital.volume': 1.6,
  'nasolabial.volume': 2.1,
  'temple.volume': 2.9,
  'masseter.reduction': 2.5,
};

export const SliderValue = z.number().min(-1).max(1);

const sliderIds = SLIDERS.map((s) => s.id) as [SliderId, ...SliderId[]];

/** Parâmetros de uma versão de simulação. Ausente = 0. */
export const SimulationParams = z.partialRecord(z.enum(sliderIds), SliderValue);
export type SimulationParams = z.infer<typeof SimulationParams>;
