import { z } from 'zod';

/** Painel da clínica (visão geral): só números e atividade recente, sem imagens. */
export interface DashboardStats {
  patients: { total: number; withActiveConsent: number; pendingConsent: number; newThisMonth: number };
  captures: { thisMonth: number; open: number };
  simulations: { total: number; thisMonth: number; versionsThisMonth: number };
  /** Últimas atividades (capturas e simulações). Vazio para quem não vê fotos/modelos. */
  recent: { kind: 'CAPTURE' | 'SIMULATION'; patientId: string; patientName: string; at: string }[];
}

export const PatientNoteCreate = z.object({
  text: z.string().trim().min(1, 'Escreva a anotação').max(2000, 'Máximo de 2000 letras'),
});
export type PatientNoteCreate = z.infer<typeof PatientNoteCreate>;

export interface PatientNote {
  id: string;
  text: string;
  createdAt: string;
  author: { id: string; name: string };
}

export const TIMELINE_KINDS = ['PATIENT', 'CONSENT', 'CAPTURE', 'SIMULATION', 'NOTE'] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

/** Linha do tempo do paciente: tudo o que aconteceu, do mais novo ao mais antigo. */
export interface TimelineItem {
  id: string;
  kind: TimelineKind;
  title: string;
  detail?: string | null;
  at: string;
  by: string | null;
  /** Para onde levar o clique (captura, simulação etc.). */
  ref?: { type: 'capture' | 'simulation' | 'reconstruction'; id: string } | null;
}
