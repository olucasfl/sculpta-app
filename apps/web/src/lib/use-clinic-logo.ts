import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './api';
import { useAuth } from './auth-store';

/**
 * Logo da clínica ativa como URL local (blob). A imagem é protegida (exige sessão e a clínica certa),
 * por isso vem por `fetch` autenticado e não por uma tag <img src> direta.
 */
export function useClinicLogo(enabled = true): string | null {
  const clinicId = useAuth((s) => s.activeClinicId);
  const blob = useQuery({
    queryKey: ['clinic-logo', clinicId],
    enabled: enabled && !!clinicId,
    staleTime: 5 * 60_000,
    queryFn: () => api<Blob>('/clinic/logo', { blob: true }),
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob.data) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob.data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob.data]);
  return url;
}
