import {
  ANGLE_RULES,
  FACE_HEIGHT_RANGE,
  PHOTO_MAX_SIDE,
  SHARPNESS_MIN,
  yawInRange,
  type PhotoAngle,
} from '@sim/contracts';

/**
 * Sinal do yaw. A matriz do MediaPipe dá a rotação no referencial da câmera; aqui
 * convertemos para o referencial do paciente (positivo = virou para a própria esquerda).
 * [validar com câmera real] Se a liberação acontecer no lado trocado, inverta este sinal.
 */
export const YAW_SIGN = -1;

/** Yaw em graus a partir da matriz 4x4 (column-major) `facialTransformationMatrixes`. */
export function yawFromMatrix(m: ArrayLike<number>): number {
  // Rotação em Y: R(0,2) = sen(yaw), R(2,2) = cos(yaw). Column-major: (r, c) = m[c*4 + r].
  const sin = m[8] ?? 0;
  const cos = m[10] ?? 1;
  return YAW_SIGN * ((Math.atan2(sin, cos) * 180) / Math.PI);
}

export interface Point {
  x: number;
  y: number;
}

/** Altura do rosto (fração da imagem) e centro, a partir dos landmarks normalizados. */
export function faceBox(landmarks: Point[]) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { heightRatio: maxY - minY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
}

/** Converte RGBA em tons de cinza (luma BT.601). */
export function toGray(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = (rgba[i]! * 299 + rgba[i + 1]! * 587 + rgba[i + 2]! * 114) / 1000;
  }
  return out;
}

/**
 * Nitidez = variância do Laplaciano (kernel 4-vizinhos). Imagem borrada tem bordas
 * suaves, Laplaciano perto de zero e variância baixa.
 */
export function laplacianVariance(gray: Uint8Array, width: number, height: number): number {
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = gray[i - width]! + gray[i + width]! + gray[i - 1]! + gray[i + 1]! - 4 * gray[i]!;
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Dimensões que cabem em `max` mantendo a proporção. */
export function fitWithin(width: number, height: number, max = PHOTO_MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export interface FrameAnalysis {
  faceDetected: boolean;
  yawDeg: number | null;
  faceHeightRatio: number | null;
  centerOffset: number | null;
  sharpness: number | null;
}

export interface Check {
  id: 'face' | 'angle' | 'size' | 'center' | 'sharp';
  ok: boolean;
  label: string;
  hint?: string;
}

/** Regras de liberação da foto (planejamento §5.1, item 3). */
export function evaluate(angle: PhotoAngle, a: FrameAnalysis): { checks: Check[]; ready: boolean } {
  const rule = ANGLE_RULES[angle];
  const checks: Check[] = [];
  checks.push({
    id: 'face',
    ok: a.faceDetected,
    label: 'Rosto detectado',
    hint: a.faceDetected ? undefined : rule.profile ? 'No perfil a detecção costuma falhar; use a captura manual se preciso.' : 'Posicione o rosto dentro da guia.',
  });
  if (a.faceDetected && a.yawDeg !== null) {
    const ok = yawInRange(angle, a.yawDeg);
    const target = (rule.yawMin + rule.yawMax) / 2;
    const turnLeft = a.yawDeg < target;
    checks.push({
      id: 'angle',
      ok,
      label: `Ângulo ${Math.round(Math.abs(a.yawDeg))}° (alvo ${rule.yawMin < 0 && rule.yawMax > 0 ? `até ${rule.yawMax}°` : `${Math.min(Math.abs(rule.yawMin), Math.abs(rule.yawMax))}–${Math.max(Math.abs(rule.yawMin), Math.abs(rule.yawMax))}°`})`,
      hint: ok ? undefined : `Vire um pouco para a ${turnLeft ? 'esquerda' : 'direita'} do paciente.`,
    });
  }
  if (a.faceDetected && a.faceHeightRatio !== null) {
    const r = a.faceHeightRatio;
    const ok = r >= FACE_HEIGHT_RANGE.min && r <= FACE_HEIGHT_RANGE.max;
    checks.push({
      id: 'size',
      ok,
      label: `Enquadramento ${Math.round(r * 100)}% da altura`,
      hint: ok ? undefined : r < FACE_HEIGHT_RANGE.min ? 'Aproxime a câmera.' : 'Afaste a câmera.',
    });
  }
  if (a.faceDetected && a.centerOffset !== null) {
    const ok = a.centerOffset <= 0.15;
    checks.push({ id: 'center', ok, label: 'Rosto centralizado', hint: ok ? undefined : 'Centralize o rosto na guia.' });
  }
  if (a.sharpness !== null) {
    const ok = a.sharpness >= SHARPNESS_MIN;
    checks.push({ id: 'sharp', ok, label: 'Imagem nítida', hint: ok ? undefined : 'Segure firme e melhore a luz.' });
  }
  const ready = a.faceDetected && checks.every((c) => c.ok) && checks.some((c) => c.id === 'angle');
  return { checks, ready };
}
