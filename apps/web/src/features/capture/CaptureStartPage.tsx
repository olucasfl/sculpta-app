import { Camera, FileSignature, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Card, PageHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, Loading } from '../../components/ui/States';
import { toast } from '../../components/ui/Toaster';
import { errorMessage } from '../../lib/api';
import { ConsentBadge } from '../patients/ConsentBadge';
import { usePatients } from '../patients/queries';
import { useStartCapture } from './queries';

/** Escolha do paciente para uma nova sessão de captura. */
export function CaptureStartPage() {
  const [search, setSearch] = useState('');
  const q = usePatients({ search: search || undefined, pageSize: 10 });
  const start = useStartCapture();
  const navigate = useNavigate();

  return (
    <>
      <PageHeader title="Captura facial" description="Escolha o paciente. Sem termo ativo, a captura fica bloqueada." />
      <Card>
        <div className="border-b border-line p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar paciente"
              aria-label="Buscar paciente"
              className="h-10 w-full rounded-lg border border-field bg-surface pl-9 pr-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.data.items.length === 0 ? (
          <EmptyState title="Nenhum paciente encontrado" action={<ButtonLink to="/patients?novo=1">Cadastrar paciente</ButtonLink>} />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.items.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <span className="flex flex-wrap items-center gap-3">
                  <span className="font-medium">{p.name}</span>
                  <ConsentBadge state={p.consentState} />
                </span>
                {p.consentState === 'ACTIVE' ? (
                  <Button
                    size="sm"
                    icon={<Camera className="size-4" aria-hidden />}
                    loading={start.isPending && start.variables === p.id}
                    onClick={async () => {
                      try {
                        const s = await start.mutateAsync(p.id);
                        navigate(`/capture/${s.id}`);
                      } catch (e) {
                        toast.error(errorMessage(e));
                      }
                    }}
                  >
                    Iniciar captura
                  </Button>
                ) : (
                  <ButtonLink to={`/patients/${p.id}/consent`} size="sm" variant="secondary" icon={<FileSignature className="size-4" aria-hidden />}>
                    Assinar termo primeiro
                  </ButtonLink>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
