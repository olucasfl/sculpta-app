import type { FrameAnalysis } from './vision/analysis';

export const readFlag = (key: string, fallback: boolean) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
};
export const writeFlag = (key: string, value: boolean) => {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* sem armazenamento */
  }
};
/** Se a câmera marcar o lado trocado, o profissional inverte aqui (guardado neste navegador). */
export const applyFlip = (a: FrameAnalysis, flip: boolean): FrameAnalysis =>
  flip ? { ...a, yawDeg: a.yawDeg === null ? null : -a.yawDeg, pitchDeg: a.pitchDeg == null ? a.pitchDeg : -a.pitchDeg } : a;
