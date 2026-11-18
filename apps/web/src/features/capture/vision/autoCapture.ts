import { PhotoAngle } from '@sim/contracts';
import { evaluate, type FrameAnalysis } from './analysis';

/** Tempo que a pose precisa ficar dentro das regras antes da foto automática. */
export const STABLE_MS = 1000;
/** A foto sai quando o quadro atual é quase tão nítido quanto o melhor visto durante a espera. */
export const SHARP_KEEP = 0.85;

export interface StabilityState {
  since: number | null;
  bestSharpness: number;
}

export const initialStability = (): StabilityState => ({ since: null, bestSharpness: 0 });

/**
 * Foto automática: conta o tempo em que a pose está dentro das regras. Sair da pose zera a contagem.
 * `progress` (0–1) alimenta o anel de contagem; `fire` é verdadeiro uma vez, quando a contagem fecha e o
 * quadro não está pior que o melhor da espera (evita disparar num quadro tremido).
 */
export function stepStability(state: StabilityState, now: number, ready: boolean, sharpness: number | null) {
  if (!ready) return { state: initialStability(), progress: 0, fire: false };
  const since = state.since ?? now;
  const bestSharpness = Math.max(state.bestSharpness, sharpness ?? 0);
  const progress = Math.min(1, (now - since) / STABLE_MS);
  const sharpEnough = sharpness === null || sharpness >= bestSharpness * SHARP_KEEP;
  return { state: { since, bestSharpness }, progress, fire: progress >= 1 && sharpEnough };
}

export interface VideoSample {
  /** Instante no vídeo, em segundos. */
  t: number;
  analysis: FrameAnalysis;
}

/** Qualidade de um quadro: nitidez × tamanho do rosto. */
export const frameScore = (a: FrameAnalysis) => (a.sharpness ?? 0) * (a.faceHeightRatio ?? 0);

/**
 * Escolhe, para cada vista, o melhor quadro do vídeo: o que cumpre as regras daquela vista (ângulo, inclinação,
 * tamanho, nitidez) com maior qualidade. Vista sem quadro válido fica de fora, e o usuário refaz por foto.
 * Um mesmo quadro nunca serve a duas vistas.
 */
export function pickFrames(samples: VideoSample[], angles: readonly PhotoAngle[] = PhotoAngle.options): Map<PhotoAngle, VideoSample> {
  const chosen = new Map<PhotoAngle, VideoSample>();
  const used = new Set<VideoSample>();
  for (const angle of angles) {
    let best: VideoSample | null = null;
    for (const s of samples) {
      if (used.has(s) || !evaluate(angle, s.analysis).ready) continue;
      if (!best || frameScore(s.analysis) > frameScore(best.analysis)) best = s;
    }
    if (best) {
      chosen.set(angle, best);
      used.add(best);
    }
  }
  return chosen;
}
