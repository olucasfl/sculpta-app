import type {
  Consent,
  ConsentCreate,
  Paginated,
  Patient,
  PatientCreate,
  PatientUpdate,
} from '@sim/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

export interface PatientFilters {
  search?: string;
  page?: number;
  pageSize?: number;
  consent?: 'active' | 'pending';
}

export const patientKeys = {
  all: ['patients'] as const,
  list: (f: PatientFilters) => ['patients', 'list', f] as const,
  detail: (id: string) => ['patients', 'detail', id] as const,
  consents: (id: string) => ['patients', 'consents', id] as const,
};

export const usePatients = (f: PatientFilters) =>
  useQuery({
    queryKey: patientKeys.list(f),
    queryFn: () => api<Paginated<Patient>>('/patients', { query: { ...f } }),
    placeholderData: keepPreviousData,
  });

export const usePatient = (id: string) =>
  useQuery({ queryKey: patientKeys.detail(id), queryFn: () => api<Patient>(`/patients/${id}`) });

export const useConsents = (patientId: string) =>
  useQuery({
    queryKey: patientKeys.consents(patientId),
    queryFn: () => api<Consent[]>(`/patients/${patientId}/consents`),
  });

function useInvalidatePatients() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: patientKeys.all });
}

export function useCreatePatient() {
  const invalidate = useInvalidatePatients();
  return useMutation({
    mutationFn: (body: PatientCreate) => api<Patient>('/patients', { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useUpdatePatient(id: string) {
  const invalidate = useInvalidatePatients();
  return useMutation({
    mutationFn: (body: PatientUpdate) => api<Patient>(`/patients/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
}

export function useDeletePatient() {
  const invalidate = useInvalidatePatients();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/patients/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useSignConsent(patientId: string) {
  const invalidate = useInvalidatePatients();
  return useMutation({
    mutationFn: (body: ConsentCreate) => api<Consent>(`/patients/${patientId}/consents`, { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useRevokeConsent() {
  const invalidate = useInvalidatePatients();
  return useMutation({
    mutationFn: (consentId: string) =>
      api<{ revoked: true; biometricsPurged: boolean }>(`/consents/${consentId}/revoke`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export const fetchSignature = (consentId: string) => api<Blob>(`/consents/${consentId}/signature`, { blob: true });
