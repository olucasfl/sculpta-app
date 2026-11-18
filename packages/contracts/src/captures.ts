import { z } from 'zod';

export const PhotoAngle = z.enum(['FRONT', 'LEFT_45', 'RIGHT_45', 'LEFT_90', 'RIGHT_90']);
export type PhotoAngle = z.infer<typeof PhotoAngle>;

/**
 * Regras de cada vista (planejamento §5.1). `yaw` é a rotação da cabeça em graus, no
 * referencial do paciente: positivo = virou para a própria esquerda.
 * O MediaPipe costuma perder o rosto perto de 90°, por isso o perfil aceita validação manual.
 */
export const ANGLE_RULES: Record<
  PhotoAngle,
  { label: string; short: string; instruction: string; yawMin: number; yawMax: number; profile: boolean }
> = {
  FRONT: {
    label: 'Frontal',
    short: 'Frente',
    instruction: 'Olhe para a câmera, queixo paralelo ao chão, expressão neutra.',
    yawMin: -5,
    yawMax: 5,
    profile: false,
  },
  LEFT_45: {
    label: '45° à esquerda',
    short: '45° esq.',
    instruction: 'Vire o rosto devagar para a sua esquerda, até a metade do caminho.',
    yawMin: 35,
    yawMax: 55,
    profile: false,
  },
  RIGHT_45: {
    label: '45° à direita',
    short: '45° dir.',
    instruction: 'Vire o rosto devagar para a sua direita, até a metade do caminho.',
    yawMin: -55,
    yawMax: -35,
    profile: false,
  },
  LEFT_90: {
    label: 'Perfil esquerdo',
    short: 'Perfil esq.',
    instruction: 'Vire o rosto totalmente para a sua esquerda, mostrando o perfil.',
    yawMin: 80,
    yawMax: 100,
    profile: true,
  },
  RIGHT_90: {
    label: 'Perfil direito',
    short: 'Perfil dir.',
    instruction: 'Vire o rosto totalmente para a sua direita, mostrando o perfil.',
    yawMin: -100,
    yawMax: -80,
    profile: true,
  },
};

/** Rosto ocupando entre 40% e 70% da altura da foto. */
export const FACE_HEIGHT_RANGE = { min: 0.4, max: 0.7 } as const;
/** Variância do Laplaciano mínima (imagem reduzida a 256 px, tons de cinza 0–255). */
export const SHARPNESS_MIN = 60;
export const PHOTO_MAX_SIDE = 2048;
export const PHOTO_MAX_BYTES = 12 * 1024 * 1024;

export const CaptureStatus = z.enum(['OPEN', 'COMPLETED', 'CANCELED']);
export type CaptureStatus = z.infer<typeof CaptureStatus>;

export const PhotoValidation = z.enum(['AUTO', 'MANUAL']);
export type PhotoValidation = z.infer<typeof PhotoValidation>;

const Landmark = z.tuple([z.number(), z.number(), z.number()]);

/** Metadados enviados depois do upload direto ao storage. */
export const PhotoRegister = z.object({
  key: z.string().min(1).max(300),
  width: z.number().int().min(64).max(8192),
  height: z.number().int().min(64).max(8192),
  yawDeg: z.number().min(-180).max(180).nullable(),
  sharpness: z.number().min(0).nullable(),
  faceDetected: z.boolean(),
  faceHeightRatio: z.number().min(0).max(2).nullable(),
  validation: PhotoValidation,
  /** Só na frontal: 478 pontos normalizados do MediaPipe. */
  landmarks: z.array(Landmark).max(500).optional(),
  source: z.enum(['CAMERA', 'UPLOAD']),
});
export type PhotoRegister = z.infer<typeof PhotoRegister>;

export interface UploadTarget {
  angle: PhotoAngle;
  key: string;
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

export interface CapturePhoto {
  id: string;
  angle: PhotoAngle;
  width: number | null;
  height: number | null;
  yawDeg: number | null;
  sharpness: number | null;
  faceDetected: boolean | null;
  validation: PhotoValidation;
  createdAt: string;
  /** URL de leitura de curta duração. */
  url: string;
  /** Pontos do rosto (MediaPipe, normalizados). Só na vista frontal; usados para tirar cores da foto. */
  landmarks?: [number, number, number][] | null;
}

export const ReconstructionStatus = z.enum(['QUEUED', 'PROCESSING', 'DONE', 'FAILED']);
export type ReconstructionStatus = z.infer<typeof ReconstructionStatus>;
export const ReconstructionSource = z.enum(['VGGTFACE', 'TEMPLATE', 'FALLBACK_FIT']);
export type ReconstructionSource = z.infer<typeof ReconstructionSource>;

export const RECONSTRUCTION_ERRORS = {
  FACE_NOT_FOUND: 'Rosto não encontrado em uma das fotos. Refaça a captura dessa vista.',
  LOW_QUALITY: 'Qualidade insuficiente para o modelo 3D. Refaça a captura com mais luz e foco.',
  TIMEOUT: 'O processamento demorou demais. Uma nova tentativa é feita automaticamente.',
  INTERNAL: 'Erro no processamento. Uma nova tentativa é feita automaticamente.',
} as const;
export type ReconstructionError = keyof typeof RECONSTRUCTION_ERRORS;

/**
 * Confiança do modelo (docs/GUIA-REFORMULACAO.md, 6.6). Enquanto o rosto é o template, é DEMO (selo permanente).
 * Reconstruído: alta (≥ 0,80), média (≥ 0,60) ou baixa. Baixa NÃO libera o simulador: o app prefere recusar
 * a mostrar um rosto que as fotos não sustentam.
 */
export type ModelConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'DEMO';
export const CONFIDENCE_THRESHOLDS = { high: 0.8, medium: 0.6 } as const;

export function modelConfidence(source: ReconstructionSource, qualityScore: number | null): ModelConfidence {
  if (source === 'TEMPLATE') return 'DEMO';
  if (qualityScore === null) return 'LOW';
  if (qualityScore >= CONFIDENCE_THRESHOLDS.high) return 'HIGH';
  if (qualityScore >= CONFIDENCE_THRESHOLDS.medium) return 'MEDIUM';
  return 'LOW';
}

export interface Reconstruction {
  id: string;
  captureId: string;
  patientId: string;
  status: ReconstructionStatus;
  source: ReconstructionSource;
  qualityScore: number | null;
  error: ReconstructionError | null;
  errorDetail: string | null;
  attempts: number;
  createdAt: string;
  finishedAt: string | null;
  /** URL do .glb (curta duração). `null` para o template, que vem com o app. */
  meshUrl: string | null;
}

export interface CaptureSession {
  id: string;
  patientId: string;
  status: CaptureStatus;
  createdAt: string;
  capturedBy: { id: string; name: string };
  photos: CapturePhoto[];
  reconstructions: Pick<Reconstruction, 'id' | 'status' | 'source' | 'qualityScore' | 'createdAt'>[];
}

/** Resumo para o histórico do paciente. */
export interface CaptureSummary {
  id: string;
  status: CaptureStatus;
  createdAt: string;
  photoCount: number;
  reconstructions: Pick<Reconstruction, 'id' | 'status' | 'source' | 'qualityScore' | 'createdAt'>[];
}

export function yawInRange(angle: PhotoAngle, yaw: number) {
  const r = ANGLE_RULES[angle];
  return yaw >= r.yawMin && yaw <= r.yawMax;
}
