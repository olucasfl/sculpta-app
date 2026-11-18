import type { ExportLog, Simulation, SimulationSummary, SimulationVersionCreate } from '@sim/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

export const simulationKeys = {
  detail: (id: string) => ['simulations', id] as const,
  list: (patientId?: string) => ['simulations', 'list', patientId ?? 'all'] as const,
};

export const useSimulation = (id: string) =>
  useQuery({ queryKey: simulationKeys.detail(id), queryFn: () => api<Simulation>(`/simulations/${id}`) });

export const useSimulations = (patientId?: string) =>
  useQuery({
    queryKey: simulationKeys.list(patientId),
    queryFn: () => api<SimulationSummary[]>('/simulations', { query: { patientId } }),
  });

export function useSaveVersion(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SimulationVersionCreate) => api<Simulation>(`/simulations/${id}/versions`, { method: 'POST', body }),
    onSuccess: (s) => {
      qc.setQueryData(simulationKeys.detail(id), s);
      void qc.invalidateQueries({ queryKey: ['simulations', 'list'] });
    },
  });
}

export const logExport = (id: string, body: ExportLog) =>
  api<void>(`/simulations/${id}/export-log`, { method: 'POST', body });
