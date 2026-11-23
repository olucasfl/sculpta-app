/**
 * Aparência do rosto no simulador (E3): tom de pele, cor dos olhos e do cabelo, forma do cabelo.
 * É só visual e vale para o modelo genérico (template) e para o reconstruído. As cores podem vir da foto
 * do paciente (ver photoColors.ts) ou ser escolhidas à mão.
 */

export type EyeColorId = 'castanho' | 'mel' | 'verde' | 'azul' | 'cinza';

export interface Appearance {
  /** 0 (pele clara) a 1 (pele escura). */
  skinTone: number;
  /** Cor da pele vinda da foto (hex); se existir, vale no lugar do tom. */
  skinHex: string | null;
  eyeColor: EyeColorId;
  /** Cor da íris vinda da foto (hex); se existir, vale no lugar da cor escolhida. */
  irisHex: string | null;
  hairVisible: boolean;
  /** Fios finos de cabelo por cima da casca (experimental; só no modelo reconstruído). */
  hairStrands: boolean;
  /** Casca de cabelo sobre o modelo reconstruído (experimental, desligada: a textura das fotos já traz o cabelo). */
  hairCap: boolean;
  hairHex: string;
  /** 0 a 1: espessura da camada de cabelo. */
  hairVolume: number;
  /** 0 (curto) a 1 (longo, desce pela nuca e pelas laterais). */
  hairLength: number;
  /** 0 (testa baixa) a 1 (entradas altas). */
  hairline: number;
  browHex: string;
  /** Modo leve: sem poros e sem brilho de pele, para aparelhos fracos. */
  light: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  skinTone: 0.3,
  skinHex: null,
  eyeColor: 'castanho',
  irisHex: null,
  hairVisible: true,
  hairStrands: false,
  hairCap: false,
  hairHex: '#3b2a1e',
  hairVolume: 0.5,
  hairLength: 0.25,
  hairline: 0.4,
  browHex: '#2e2118',
  light: false,
};

export const EYE_COLORS: Record<EyeColorId, { label: string; hex: string }> = {
  castanho: { label: 'Castanho', hex: '#5a3a22' },
  mel: { label: 'Mel', hex: '#a06a2c' },
  verde: { label: 'Verde', hex: '#4f7a4a' },
  azul: { label: 'Azul', hex: '#4a74a8' },
  cinza: { label: 'Cinza', hex: '#7b8794' },
};

export const HAIR_SWATCHES = ['#0f0b09', '#3b2a1e', '#6b4a2f', '#a47b4b', '#c9a86a', '#8a8a8a', '#8c3b24'];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbToHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

/** Âncoras de tom de pele (claro, médio, escuro), interpoladas. */
const SKIN_ANCHORS = ['#e9cdbb', '#c99a7a', '#8a5a3c'] as const;

export function skinColor(a: Appearance): string {
  if (a.skinHex) return a.skinHex;
  const t = Math.max(0, Math.min(1, a.skinTone)) * 2;
  const i = Math.min(1, Math.floor(t));
  const [r1, g1, b1] = hexToRgb(SKIN_ANCHORS[i]!);
  const [r2, g2, b2] = hexToRgb(SKIN_ANCHORS[i + 1]!);
  const f = t - i;
  return rgbToHex(lerp(r1, r2, f), lerp(g1, g2, f), lerp(b1, b2, f));
}

export const irisColor = (a: Appearance): string => a.irisHex ?? EYE_COLORS[a.eyeColor].hex;

/** Modo leve sugerido: poucos núcleos ou pouca memória (a medição real é por aparelho, ver o guia). */
export function suggestLightMode(nav: { hardwareConcurrency?: number; deviceMemory?: number } = navigator as never): boolean {
  return (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 3;
}

const KEY = (simulationId: string) => `sculpta.appearance.${simulationId}`;

/** A aparência fica no navegador, por simulação (não é parte do que se salva na versão). */
export function loadAppearance(simulationId: string): Appearance {
  try {
    const raw = localStorage.getItem(KEY(simulationId));
    if (raw) return { ...DEFAULT_APPEARANCE, ...(JSON.parse(raw) as Partial<Appearance>) };
  } catch {
    /* sem armazenamento ou dado inválido: usa o padrão */
  }
  return { ...DEFAULT_APPEARANCE, light: suggestLightMode() };
}

export function saveAppearance(simulationId: string, a: Appearance) {
  try {
    localStorage.setItem(KEY(simulationId), JSON.stringify(a));
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
}
