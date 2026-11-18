import type {
  CaptureSession,
  CaptureSummary,
  PhotoAngle,
  PhotoRegister,
  Reconstruction,
  UploadTarget,
} from '@sim/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';

export const captureKeys = {
  session: (id: string) => ['captures', id] as const,
  forPatient: (patientId: string) => ['patients', 'captures', patientId] as const,
  reconstruction: (id: string) => ['reconstructions', id] as const,
};

export const useCaptureSession = (id: string) =>
  useQuery({ queryKey: captureKeys.session(id), queryFn: () => api<CaptureSession>(`/captures/${id}`) });

export const usePatientCaptures = (patientId: string) =>
  useQuery({
    queryKey: captureKeys.forPatient(patientId),
    queryFn: () => api<CaptureSummary[]>(`/patients/${patientId}/captures`),
  });

export function useStartCapture() {
  return useMutation({
    mutationFn: (patientId: string) => api<CaptureSession>(`/patients/${patientId}/captures`, { method: 'POST' }),
  });
}

/** Upload direto ao storage (URL pré-assinada) e registro dos metadados na API. */
export async function uploadPhoto(captureId: string, angle: PhotoAngle, blob: Blob, meta: Omit<PhotoRegister, 'key'>) {
  const target = await api<UploadTarget>(`/captures/${captureId}/uploads/${angle}`, { method: 'POST' });
  let res: Response;
  try {
    res = await fetch(target.url, { method: 'PUT', headers: target.headers, body: blob });
  } catch {
    throw new ApiError(0, { statusCode: 0, code: 'NETWORK', message: 'Falha de rede ao enviar a foto' });
  }
  if (!res.ok) throw new ApiError(res.status, { statusCode: res.status, code: 'UPLOAD_FAILED', message: 'O envio da foto falhou. Tente de novo.' });
  return api<CaptureSession>(`/captures/${captureId}/photos/${angle}`, { method: 'PUT', body: { ...meta, key: target.key } });
}

export function useCaptureActions(captureId: string) {
  const qc = useQueryClient();
  const set = (s: CaptureSession) => qc.setQueryData(captureKeys.session(captureId), s);
  return {
    deletePhoto: useMutation({
      mutationFn: (angle: PhotoAngle) => api<CaptureSession>(`/captures/${captureId}/photos/${angle}`, { method: 'DELETE' }),
      onSuccess: set,
    }),
    complete: useMutation({
      mutationFn: () => api<Reconstruction>(`/captures/${captureId}/complete`, { method: 'POST' }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['patients'] }),
    }),
    cancel: useMutation({
      mutationFn: () => api<void>(`/captures/${captureId}/cancel`, { method: 'POST' }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['patients'] }),
    }),
    set,
  };
}

/** Acompanha a reconstrução a cada 2 s até terminar. */
export const useReconstruction = (id: string) =>
  useQuery({
    queryKey: captureKeys.reconstruction(id),
    queryFn: () => api<Reconstruction>(`/reconstructions/${id}`),
    refetchInterval: (q) => (q.state.data && ['DONE', 'FAILED'].includes(q.state.data.status) ? false : 2000),
  });
