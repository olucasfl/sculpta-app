import type { FaceLandmarker as FL, FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import { faceBox, laplacianVariance, toGray, pitchFromMatrix, yawFromMatrix, type FrameAnalysis } from './analysis';

/**
 * MediaPipe Face Landmarker rodando NO NAVEGADOR: as imagens não saem do aparelho.
 * - WASM: servido pelo próprio app em /mediapipe/wasm (copiado de node_modules no install).
 * - Modelo: /models/face_landmarker.task se existir (`pnpm --filter @sim/web setup:model`);
 *   senão, o arquivo oficial do Google. Só o modelo é baixado; nenhuma foto é enviada.
 */
const WASM_PATH = '/mediapipe/wasm';
const LOCAL_MODEL = '/models/face_landmarker.task';
const REMOTE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export type LandmarkerMode = 'VIDEO' | 'IMAGE';

const instances = new Map<LandmarkerMode, Promise<FL>>();

async function modelPath() {
  try {
    const r = await fetch(LOCAL_MODEL, { method: 'HEAD' });
    if (r.ok && !r.headers.get('content-type')?.includes('text/html')) return LOCAL_MODEL;
  } catch {
    /* sem modelo local */
  }
  return REMOTE_MODEL;
}

async function create(mode: LandmarkerMode): Promise<FL> {
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const base = {
    runningMode: mode,
    numFaces: 1,
    outputFacialTransformationMatrixes: true,
    outputFaceBlendshapes: false,
  } as const;
  const modelAssetPath = await modelPath();
  try {
    return await FaceLandmarker.createFromOptions(fileset, { ...base, baseOptions: { modelAssetPath, delegate: 'GPU' } });
  } catch {
    return FaceLandmarker.createFromOptions(fileset, { ...base, baseOptions: { modelAssetPath, delegate: 'CPU' } });
  }
}

export function getLandmarker(mode: LandmarkerMode): Promise<FL> {
  let p = instances.get(mode);
  if (!p) {
    p = create(mode);
    p.catch(() => instances.delete(mode));
    instances.set(mode, p);
  }
  return p;
}

export async function releaseLandmarkers() {
  const all = [...instances.values()];
  instances.clear();
  for (const p of all) (await p.catch(() => null))?.close();
}

const SHARP_SIZE = 256;
let scratch: HTMLCanvasElement | null = null;

/** Nitidez do quadro, numa cópia reduzida a 256 px (rápido o bastante para tempo real). */
export function measureSharpness(source: CanvasImageSource, width: number, height: number) {
  scratch ??= document.createElement('canvas');
  const scale = SHARP_SIZE / Math.max(width, height);
  const w = Math.max(8, Math.round(width * scale));
  const h = Math.max(8, Math.round(height * scale));
  scratch.width = w;
  scratch.height = h;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  return laplacianVariance(toGray(ctx.getImageData(0, 0, w, h).data, w, h), w, h);
}

export function analyzeResult(result: FaceLandmarkerResult | null, sharpness: number | null): FrameAnalysis & {
  landmarks: { x: number; y: number; z: number }[] | null;
} {
  const lm = result?.faceLandmarks[0];
  const matrix = result?.facialTransformationMatrixes?.[0];
  if (!lm || lm.length === 0) {
    return { faceDetected: false, yawDeg: null, pitchDeg: null, faceHeightRatio: null, centerOffset: null, sharpness, landmarks: null };
  }
  const box = faceBox(lm);
  return {
    faceDetected: true,
    yawDeg: matrix ? yawFromMatrix(matrix.data) : null,
    pitchDeg: matrix ? pitchFromMatrix(matrix.data) : null,
    faceHeightRatio: box.heightRatio,
    centerOffset: Math.hypot(box.centerX - 0.5, box.centerY - 0.5),
    sharpness,
    landmarks: lm.map((p) => ({ x: p.x, y: p.y, z: p.z })),
  };
}
