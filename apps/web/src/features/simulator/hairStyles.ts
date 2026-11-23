/**
 * Estilos de cabelo do simulador (modelo reconstruído).
 *
 * "Automático" usa o que o worker mediu na foto frontal (comprimento, franja, volume, cacho, cor). Se não ficar bom,
 * a pessoa escolhe um dos modelos prontos (5 masculinos, 5 femininos), muda o tamanho e a cor.
 * É uma representação visual de fios; não é o penteado real do paciente.
 */
import type { StrandStyle } from './hairStrands';

/** O que o worker leu na foto frontal (`hairStyle` nos extras do .glb). */
export interface DetectedHair {
  hasHair: boolean;
  /** Até onde o cabelo desce ao lado do rosto, a partir dos olhos, em alturas de rosto (1 = queixo). */
  length: number;
  fringe: number;
  fringeDepth?: number;
  /** Largura do cabelo no alto da cabeça dividida pela largura do rosto. */
  volume: number;
  curl: number;
  color: string | null;
}

export type HairModelId = 'auto' | 'none' | (typeof HAIR_PRESETS)[number]['id'];

export interface HairPreset {
  id: string;
  label: string;
  gender: 'm' | 'f';
  style: StrandStyle;
}

const P = (
  id: string,
  label: string,
  gender: 'm' | 'f',
  [top, side, back]: [number, number, number],
  [fringe, curl, puff]: [number, number, number],
  dir: Pick<StrandStyle, 'part' | 'partX' | 'sweep' | 'comb' | 'lift' | 'wave'> = {},
): HairPreset => ({ id, label, gender, style: { top, side, back, fringe, curl, puff, ...dir } });

export const HAIR_PRESETS = [
  P('m-curto', 'Curto social (para trás)', 'm', [0.045, 0.012, 0.012], [0, 0, 0.1], { comb: 0.8 }),
  P('m-franja', 'Curto com franja de lado', 'm', [0.06, 0.018, 0.015], [0.85, 0.05, 0.1], { sweep: 0.8, part: 0.3, partX: 0.03 }),
  P('m-medio', 'Médio com risca de lado', 'm', [0.09, 0.06, 0.06], [0.3, 0, 0.1], { part: 0.8, partX: 0.025, sweep: 0.3, wave: 0.15 }),
  P('m-longo', 'Longo liso, risca no meio', 'm', [0.17, 0.19, 0.21], [0, 0, 0], { part: 1, partX: 0, wave: 0.2 }),
  P('m-cacheado', 'Cacheado curto', 'm', [0.06, 0.03, 0.03], [0.3, 0.9, 0.7], { lift: 0.6 }),
  P('f-chanel', 'Chanel (risca de lado)', 'f', [0.12, 0.15, 0.12], [0, 0, 0.1], { part: 0.9, partX: 0.025, wave: 0.1 }),
  P('f-medio', 'Médio ondulado, risca no meio', 'f', [0.2, 0.26, 0.26], [0, 0, 0], { part: 1, partX: 0, wave: 0.55 }),
  P('f-longo', 'Longo liso, risca no meio', 'f', [0.3, 0.38, 0.4], [0, 0, 0], { part: 1, partX: 0 }),
  P('f-longo-franja', 'Longo ondulado com franja', 'f', [0.3, 0.38, 0.4], [0.9, 0, 0], { part: 0.4, wave: 0.5 }),
  P('f-cacheado', 'Cacheado volumoso', 'f', [0.14, 0.2, 0.18], [0.15, 0.85, 0.65], { part: 0.4, partX: 0.02, lift: 0.4 }),
] as const;

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** Converte o que foi lido na foto em estilo de fios; `null` quando a foto não mostra cabelo (raspado ou careca). */
export function styleFromDetection(d: DetectedHair | null | undefined): StrandStyle | null {
  if (!d) return { ...HAIR_PRESETS[0].style }; // modelo antigo, sem leitura: curto e discreto
  if (!d.hasHair) return null;
  const r = clamp(d.length, 0, 1.9);
  const curlRaw = clamp(d.curl, 0, 1);
  // até meio cacheado é onda larga; só acima disso vira cacho
  const curl = curlRaw > 0.5 ? curlRaw : 0;
  const wave = curlRaw > 0.5 ? 0.3 : curlRaw * 1.6;
  const puff = clamp((d.volume - 1.15) / 0.8, 0, 1) * (0.4 + 0.6 * curl);
  if (r < 0.12) {
    // curto: laterais e nuca rentes, mais comprimento em cima
    const top = 0.045 + 0.02 * d.fringe + 0.02 * puff;
    // sem franja, o cabelo curto fica penteado para trás; com franja, jogado um pouco para o lado
    return { top, side: 0.014, back: 0.012, fringe: d.fringe, curl, puff, wave: wave * 0.5, comb: d.fringe < 0.35 ? 0.5 : 0, lift: curl > 0.5 ? 0.3 * puff : 0 };
  }
  // do olho até o fim do cabelo; a raiz fica ~7 cm acima dos olhos nas laterais
  const side = clamp(0.03 + 0.22 * r, 0.03, 0.42);
  const top = r < 0.6 ? 0.05 + 0.1 * r + 0.03 * puff : side * 0.85;
  return { top, side, back: side, fringe: d.fringe, curl, puff, wave, part: d.fringe < 0.35 ? 0.7 : 0.3, partX: 0.012 };
}

export function scaleStyle(s: StrandStyle, k: number): StrandStyle {
  return { ...s, top: s.top * k, side: s.side * k, back: s.back * k };
}

/** Estilo final a desenhar: o modelo escolhido (ou o automático) vezes o tamanho; `null` = sem fios. */
export function resolveStyle(model: HairModelId, scale: number, detected: DetectedHair | null | undefined): StrandStyle | null {
  if (model === 'none') return null;
  const base = model === 'auto' ? styleFromDetection(detected) : (HAIR_PRESETS.find((p) => p.id === model)?.style ?? null);
  return base ? scaleStyle(base, clamp(scale, 0.4, 2)) : null;
}

/** Frase curta com o que foi lido na foto, para o painel. */
export function describeDetection(d: DetectedHair | null | undefined): string {
  if (!d) return 'Esta reconstrução é anterior à leitura do cabelo; refaça a captura para ler o cabelo da foto.';
  if (!d.hasHair) return 'Na foto não apareceu cabelo (raspado ou careca).';
  const len = d.length < 0.12 ? 'curto' : d.length < 0.6 ? 'médio curto' : d.length < 1.2 ? 'na altura do queixo ou um pouco abaixo' : 'comprido';
  const parts = [`cabelo ${len}`, d.fringe > 0.35 ? 'com franja' : 'sem franja', d.curl > 0.55 ? 'cacheado' : d.curl > 0.3 ? 'ondulado' : 'liso'];
  return `Lido na foto: ${parts.join(', ')}.`;
}
