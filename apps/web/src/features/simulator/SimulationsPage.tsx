import { Box } from 'lucide-react';
import { Link } from 'react-router';
import { ButtonLink } from '../../components/ui/Button';
import { Card, PageHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, Loading } from '../../components/ui/States';
import { formatDateTime } from '../../lib/format';
import { useSimulations } from './queries';

export function SimulationsPage() {
  const q = useSimulations();
  return (
    <>
      <PageHeader title="Simulações" description="Simulações recentes da clínica. Para criar uma, conclua uma captura." />
      <Card>
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.data.length === 0 ? (
          <EmptyState
            icon={<Box className="size-5" />}
            title="Nenhuma simulação ainda"
            description="Capture as 5 vistas de um paciente com termo ativo; quando o modelo 3D ficar pronto, abra o simulador."
            action={<ButtonLink to="/capture">Iniciar captura</ButtonLink>}
          />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((s) => (
              <li key={s.id}>
                <Link to={`/simulations/${s.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-subtle/60">
                  <span>
                    <span className="block font-medium">{s.patientName}</span>
                    <span className="text-xs text-muted">
                      {s.name} · {s.versionCount} versão{s.versionCount === 1 ? '' : 'ões'}
                    </span>
                  </span>
                  <span className="text-xs text-muted">{formatDateTime(s.lastVersionAt ?? s.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
