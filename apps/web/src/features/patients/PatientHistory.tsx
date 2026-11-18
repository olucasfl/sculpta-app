import { can, type Patient } from '@sim/contracts';
import { Box, Camera, History } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Badge, Card, CardHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, Loading } from '../../components/ui/States';
import { toast } from '../../components/ui/Toaster';
import { errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth-store';
import { formatDateTime } from '../../lib/format';
import { usePatientCaptures, useStartCapture } from '../capture/queries';
import { useSimulations } from '../simulator/queries';

const CAPTURE_STATUS = { OPEN: 'Em andamento', COMPLETED: 'Concluída', CANCELED: 'Cancelada' } as const;
const REC_STATUS = { QUEUED: 'Na fila', PROCESSING: 'Processando', DONE: 'Modelo pronto', FAILED: 'Falhou' } as const;

/** Histórico de capturas, reconstruções e simulações do paciente. */
export function PatientHistory({ patient }: { patient: Patient }) {
  const role = useAuth((s) => s.user?.role ?? 'RECEPCAO');
  const navigate = useNavigate();
  const canSee = can(role, 'captures.read');
  const captures = usePatientCaptures(patient.id, canSee);
  const sims = useSimulations(patient.id, canSee);
  const start = useStartCapture();
  const canCapture = can(role, 'captures.write') && patient.consentState === 'ACTIVE';

  if (!canSee) {
    return (
      <Card>
        <CardHeader title="Capturas e simulações" />
        <EmptyState
          icon={<History className="size-5" />}
          title="Fotos e modelos 3D ficam fora do seu perfil"
          description="Seu perfil cuida do cadastro e do termo de consentimento. A equipe clínica vê as capturas e as simulações."
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Capturas e simulações"
        description={patient.consentState !== 'ACTIVE' ? 'Assine o termo para liberar a captura.' : undefined}
        action={
          <Button
            size="sm"
            icon={<Camera className="size-4" aria-hidden />}
            disabled={!canCapture}
            loading={start.isPending}
            onClick={async () => {
              try {
                const s = await start.mutateAsync(patient.id);
                navigate(`/capture/${s.id}`);
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          >
            Nova captura
          </Button>
        }
      />
      {captures.isPending || sims.isPending ? (
        <Loading />
      ) : captures.isError ? (
        <ErrorState error={captures.error} onRetry={() => captures.refetch()} />
      ) : captures.data.length === 0 ? (
        <EmptyState icon={<History className="size-5" />} title="Nenhuma captura ainda" description="As sessões de fotos, os modelos 3D e as simulações aparecem aqui." />
      ) : (
        <ul className="divide-y divide-line">
          {captures.data.map((c) => {
            const rec = c.reconstructions[0];
            const simsForRec = (sims.data ?? []).filter((s) => c.reconstructions.some((r) => r.id === s.reconstructionId));
            return (
              <li key={c.id} className="space-y-2 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">Captura de {formatDateTime(c.createdAt)}</span>
                    <Badge tone={c.status === 'COMPLETED' ? 'ok' : c.status === 'OPEN' ? 'accent' : 'neutral'}>{CAPTURE_STATUS[c.status]}</Badge>
                    <span className="text-xs text-muted">{c.photoCount}/5 fotos</span>
                  </div>
                  {c.status === 'OPEN' && (
                    <Link to={`/capture/${c.id}`} className="text-sm font-medium text-accent hover:underline">Continuar</Link>
                  )}
                  {rec && (
                    <Link to={`/reconstructions/${rec.id}`} className="text-sm font-medium text-accent hover:underline">
                      {REC_STATUS[rec.status]}
                      {rec.source === 'TEMPLATE' && rec.status === 'DONE' ? ' (demonstrativo)' : ''}
                    </Link>
                  )}
                </div>
                {simsForRec.length > 0 && (
                  <ul className="space-y-1 pl-3">
                    {simsForRec.map((s) => (
                      <li key={s.id}>
                        <Link to={`/simulations/${s.id}`} className="inline-flex items-center gap-2 text-sm hover:text-accent">
                          <Box className="size-3.5" aria-hidden /> {s.name} · {s.versionCount} versão{s.versionCount === 1 ? '' : 'ões'}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
