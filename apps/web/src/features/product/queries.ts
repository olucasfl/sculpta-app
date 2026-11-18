import type { DashboardStats, PatientNote, PatientNoteCreate, TimelineItem } from '@sim/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

export const useDashboard = () => useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardStats>('/dashboard') });

export const usePatientTimeline = (patientId: string) =>
  useQuery({ queryKey: ['patients', 'timeline', patientId], queryFn: () => api<TimelineItem[]>(`/patients/${patientId}/timeline`) });

export const usePatientNotes = (patientId: string, enabled: boolean) =>
  useQuery({ queryKey: ['patients', 'notes', patientId], queryFn: () => api<PatientNote[]>(`/patients/${patientId}/notes`), enabled });

export function useNoteActions(patientId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['patients', 'notes', patientId] });
    void qc.invalidateQueries({ queryKey: ['patients', 'timeline', patientId] });
  };
  return {
    add: useMutation({
      mutationFn: (body: PatientNoteCreate) => api<PatientNote>(`/patients/${patientId}/notes`, { method: 'POST', body }),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`/notes/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

export const fetchReport = (simulationId: string) => api<Blob>(`/simulations/${simulationId}/report.pdf`, { blob: true });
