import { z } from 'zod';
import { optionalText } from './common.js';
import { SimulationParams, type SliderId } from './sliders.js';

export const SimulationCreate = z.object({
  name: z.string().trim().min(1).max(80).default('Simulação'),
});
export type SimulationCreate = z.infer<typeof SimulationCreate>;

/** Miniatura JPEG ou PNG em data URL, até ~450 KB. */
const THUMB_MAX_CHARS = 620_000;

/**
 * Escultura com o pincel: deslocamentos por vértice, esparsos e quantizados (ver apps/web simulator/sculpt.ts).
 * `i` = índices (Uint32 LE, base64); `d` = x,y,z de cada um em múltiplos de 1e-5 (Int16 LE, base64).
 */
export const SculptData = z.object({
  v: z.literal(1),
  n: z.number().int().min(1).max(200_000),
  i: z.string().max(900_000).regex(/^[A-Za-z0-9+/]*={0,2}$/, 'Deslocamentos inválidos'),
  d: z.string().max(900_000).regex(/^[A-Za-z0-9+/]*={0,2}$/, 'Deslocamentos inválidos'),
});
export type SculptData = z.infer<typeof SculptData>;

/** Confere que os dois blocos descrevem o mesmo número de vértices (4 bytes por índice, 6 por deslocamento). */
export function sculptIsConsistent(s: SculptData): boolean {
  const bytes = (b64: string) => Math.floor((b64.replace(/=+$/, '').length * 3) / 4);
  const count = bytes(s.i) / 4;
  return Number.isInteger(count) && count <= s.n && bytes(s.d) === count * 6;
}

export const SimulationVersionCreate = z.object({
  name: z.string().trim().min(1, 'Dê um nome à versão').max(80),
  description: optionalText(500),
  params: SimulationParams,
  thumbnailDataUrl: z
    .string()
    .regex(/^data:image\/(png|jpeg);base64,/, 'Miniatura inválida')
    .max(THUMB_MAX_CHARS)
    .optional(),
  /** Deslocamentos do pincel, se houve escultura. */
  sculpt: SculptData.optional(),
}).refine((v) => !v.sculpt || sculptIsConsistent(v.sculpt), { path: ['sculpt'], message: 'Deslocamentos inconsistentes' });
export type SimulationVersionCreate = z.infer<typeof SimulationVersionCreate>;

export interface SimulationVersion {
  id: string;
  name: string;
  description: string | null;
  params: SimulationParams;
  createdAt: string;
  createdBy: { id: string; name: string };
  thumbnailUrl: string | null;
  /** Deslocamentos do pincel desta versão (null = só sliders). */
  sculpt: SculptData | null;
}

export interface Simulation {
  id: string;
  reconstructionId: string;
  patientId: string;
  patientName: string;
  name: string;
  createdAt: string;
  createdBy: { id: string; name: string };
  versions: SimulationVersion[];
}

export interface SimulationSummary {
  id: string;
  reconstructionId: string;
  patientId: string;
  patientName: string;
  name: string;
  createdAt: string;
  versionCount: number;
  lastVersionAt: string | null;
}

export const ExportLog = z.object({
  versionId: z.uuid().optional(),
  views: z.array(z.enum(['FRONT', 'THREE_QUARTER', 'PROFILE'])).min(1),
});
export type ExportLog = z.infer<typeof ExportLog>;

/**
 * Presets são só configuração de INTERFACE: quais sliders aparecem e com que rótulo.
 * Não trazem valores iniciais, não são plano clínico e não indicam produto ou quantidade.
 */
export interface ProcedurePreset {
  id: string;
  label: string;
  description: string;
  sliders: SliderId[];
  limitation: string;
}

export const PROCEDURE_PRESETS: ProcedurePreset[] = [
  {
    id: 'lips',
    label: 'Lábios',
    description: 'Volume e definição do contorno labial.',
    sliders: ['lips.upperVolume', 'lips.lowerVolume', 'lips.contour'],
    limitation: 'Mostra só a forma. Cor, textura e movimento dos lábios não são simulados.',
  },
  {
    id: 'malar',
    label: 'Malar',
    description: 'Volume e projeção das maçãs do rosto.',
    sliders: ['malar.volume', 'malar.projection'],
    limitation: 'Ilustra volume superficial; não representa estrutura óssea.',
  },
  {
    id: 'chin',
    label: 'Mento',
    description: 'Projeção e altura do queixo.',
    sliders: ['chin.projection', 'chin.height'],
    limitation: 'Mudanças grandes de projeção podem exigir abordagem cirúrgica; a simulação não indica viabilidade.',
  },
  {
    id: 'jaw',
    label: 'Mandíbula',
    description: 'Definição do contorno mandibular.',
    sliders: ['jaw.width'],
    limitation: 'Ilustra o contorno visual; não representa estrutura óssea nem musculatura.',
  },
  {
    id: 'nose',
    label: 'Nariz',
    description: 'Contorno e projeção visuais do nariz.',
    sliders: ['nose.dorsumHeight', 'nose.tipProjection', 'nose.tipRotation', 'nose.bridgeWidth', 'nose.alarWidth'],
    limitation:
      'Procedimentos não cirúrgicos não reproduzem mudanças estruturais como estreitar o dorso ou reduzir as asas. Esses controles são só ilustrativos.',
  },
  {
    id: 'infraorbital',
    label: 'Olheiras',
    description: 'Suavização do sulco abaixo dos olhos (região infraorbital).',
    sliders: ['infraorbital.volume'],
    limitation: 'O resultado depende muito da qualidade da malha nessa região; olheiras de pigmento não são simuladas.',
  },
  {
    id: 'nasolabial',
    label: 'Sulco nasolabial',
    description: 'Suavização da dobra entre o nariz e a boca.',
    sliders: ['nasolabial.volume'],
    limitation: 'O resultado depende muito da qualidade da malha nessa região; a dobra dinâmica ao sorrir não é simulada.',
  },
];

export const SIMULATION_DISCLAIMER =
  'Simulação ilustrativa. Não representa garantia de resultado, avaliação clínica ou indicação de procedimento.';
