import { PhotoAngle } from '@sim/contracts';
import { evaluate, type FrameAnalysis } from './analysis';

/** Tempo que a pose precisa ficar dentro das regras antes da foto automática. */
export const STABLE_MS = 1000;
/** A foto sai quando o quadro atual é quase tão nítido quanto o melhor visto durante a espera. */
export const SHARP_KEEP = 0.85;

/** Quanto a pose pode variar durante a espera sem reiniciar a contagem (a pessoa precisa ficar parada). */
export const DRIFT_MAX = { yaw: 4, pitch: 4, size: 0.04, offset: 0.04 } as const;

export interface PoseSample {
  yaw: number | null;
  pitch: number | null;
  size: number | null;
  offset: number | null;
}

export const poseOf = (a: FrameAnalysis): PoseSample => ({
  yaw: a.yawDeg,
  pitch: a.pitchDeg ?? null,
  size: a.faceHeightRatio,
  offset: a.centerOffset,
});

const moved = (from: number | null, to: number | null, max: number) => from !== null && to !== null && Math.abs(from - to) > max;

export interface StabilityState {
  since: number | null;
  bestSharpness: number;
  /** Pose no início da contagem; mexer além de DRIFT_MAX reinicia. */
  anchor: PoseSample | null;
}

export const initialStability = (): StabilityState => ({ since: null, bestSharpness: 0, anchor: null });

/**
 * Foto automática: conta o tempo em que a pose está dentro das regras. Sair da pose zera a contagem.
 * `progress` (0–1) alimenta o anel de contagem; `fire` é verdadeiro uma vez, quando a contagem fecha e o
 * quadro não está pior que o melhor da espera (evita disparar num quadro tremido).
 */
export function stepStability(state: StabilityState, now: number, ready: boolean, sharpness: number | null, pose?: PoseSample) {
  if (!ready) return { state: initialStability(), progress: 0, fire: false };
  if (pose && state.anchor) {
    const a = state.anchor;
    if (
      moved(a.yaw, pose.yaw, DRIFT_MAX.yaw) ||
      moved(a.pitch, pose.pitch, DRIFT_MAX.pitch) ||
      moved(a.size, pose.size, DRIFT_MAX.size) ||
      moved(a.offset, pose.offset, DRIFT_MAX.offset)
    ) {
      // A pessoa se mexeu: recomeça a contagem a partir da pose atual.
      return { state: { since: now, bestSharpness: sharpness ?? 0, anchor: pose }, progress: 0, fire: false };
    }
  }
  const since = state.since ?? now;
  const anchor = state.anchor ?? pose ?? null;
  const bestSharpness = Math.max(state.bestSharpness, sharpness ?? 0);
  const progress = Math.min(1, (now - since) / STABLE_MS);
  const sharpEnough = sharpness === null || sharpness >= bestSharpness * SHARP_KEEP;
  return { state: { since, bestSharpness, anchor }, progress, fire: progress >= 1 && sharpEnough };
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
