import { can, RECONSTRUCTION_ERRORS, type Simulation } from '@sim/contracts';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Box, CheckCircle2, Loader2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ErrorState, Loading } from '../../components/ui/States';
import { toast } from '../../components/ui/Toaster';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth-store';
import { SourceBadge } from '../simulator/SourceBadge';
import { useReconstruction } from './queries';

/** Acompanha a reconstrução (polling de 2 s) e abre o simulador. */
export function ReconstructionPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const role = useAuth((s) => s.user?.role ?? 'RECEPCAO');
  const r = useReconstruction(id);
  const create = useMutation({
    mutationFn: () => api<Simulation>(`/reconstructions/${id}/simulations`, { method: 'POST', body: { name: 'Simulação' } }),
  });

  if (r.isPending) return <Loading />;
  if (r.isError) return <ErrorState error={r.error} onRetry={() => r.refetch()} />;
  const rec = r.data;

  return (
    <Card className="mx-auto max-w-xl p-8 text-center">
      {rec.status === 'QUEUED' || rec.status === 'PROCESSING' ? (
        <>
          <Loader2 className="mx-auto size-8 animate-spin text-accent" aria-hidden />
          <h1 className="mt-4 text-xl font-semibold" role="status">
            {rec.status === 'QUEUED' ? 'Na fila de processamento' : 'Gerando o modelo 3D'}
          </h1>
          <p className="mt-2 text-muted">
            {rec.attempts > 1 ? `Tentativa ${rec.attempts} de 3. ` : ''}Esta página atualiza sozinha.
          </p>
        </>
      ) : rec.status === 'DONE' ? (
        <>
          <CheckCircle2 className="mx-auto size-8 text-ok" aria-hidden />
          <h1 className="mt-4 text-xl font-semibold">Modelo 3D pronto</h1>
          <div className="mt-3 flex justify-center">
            <SourceBadge source={rec.source} qualityScore={rec.qualityScore} />
          </div>
          {rec.source === 'TEMPLATE' && (
            <p className="mx-auto mt-3 max-w-md text-sm text-muted">
              A reconstrução personalizada não está configurada neste ambiente. O simulador abre um modelo genérico, só para
              demonstrar os controles; ele não representa o rosto deste paciente.
            </p>
          )}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {can(role, 'simulations.write') ? (
              <Button
                icon={<Box className="size-4" aria-hidden />}
                loading={create.isPending}
                onClick={async () => {
                  try {
                    const s = await create.mutateAsync();
                    navigate(`/simulations/${s.id}`);
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                Abrir simulador
              </Button>
            ) : (
              <p className="text-sm text-muted">Peça a um profissional para abrir o simulador.</p>
            )}
            <Button variant="secondary" onClick={() => navigate(`/patients/${rec.patientId}`)}>Voltar ao paciente</Button>
          </div>
        </>
      ) : (
        <>
          <AlertTriangle className="mx-auto size-8 text-danger" aria-hidden />
          <h1 className="mt-4 text-xl font-semibold">Não foi possível gerar o modelo</h1>
          <p role="alert" className="mt-2 text-muted">
            {rec.error ? RECONSTRUCTION_ERRORS[rec.error] : 'Erro desconhecido.'}
          </p>
          {rec.errorDetail && <p className="mt-1 text-sm text-faint">{rec.errorDetail}</p>}
          <div className="mt-6 flex justify-center gap-2">
            <Link to={`/patients/${rec.patientId}`} className="text-sm font-medium text-accent hover:underline">
              Voltar ao paciente e refazer a captura
            </Link>
          </div>
        </>
      )}
    </Card>
  );
}
