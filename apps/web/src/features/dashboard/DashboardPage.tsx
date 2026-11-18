import { Box, Camera, FileSignature, Plus, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ButtonLink } from '../../components/ui/Button';
import { Card, CardHeader, PageHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, Loading } from '../../components/ui/States';
import { useAuth } from '../../lib/auth-store';
import { formatDate, formatDateTime } from '../../lib/format';
import { ConsentBadge } from '../patients/ConsentBadge';
import { usePatients } from '../patients/queries';
import { useDashboard } from '../product/queries';

export function DashboardPage() {
  const user = useAuth((s) => s.user);
  const recent = usePatients({ pageSize: 6 });
  const stats = useDashboard();
  const d = stats.data;

  return (
    <>
      <PageHeader title={`Olá, ${user?.name.split(' ')[0] ?? ''}`} description={user?.clinicName} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Pacientes cadastrados" value={d?.patients.total} hint={d ? `${d.patients.newThisMonth} neste mês` : undefined} icon={<Users className="size-4" aria-hidden />} to="/patients" />
        <Stat label="Sem termo ativo" value={d?.patients.pendingConsent} icon={<FileSignature className="size-4" aria-hidden />} to="/patients?termo=pending" />
        <Stat label="Capturas no mês" value={d?.captures.thisMonth} hint={d ? `${d.captures.open} em andamento` : undefined} icon={<Camera className="size-4" aria-hidden />} to="/capture" />
        <Stat label="Simulações no mês" value={d?.simulations.thisMonth} hint={d ? `${d.simulations.versionsThisMonth} versões salvas` : undefined} icon={<Box className="size-4" aria-hidden />} to="/simulations" />
      </div>
      <div className="mb-6">
        <Card className="flex flex-col justify-between gap-3 p-5">
          <p className="text-sm font-medium text-muted">Ações rápidas</p>
          <div className="flex flex-wrap gap-2">
            <ButtonLink to="/patients?novo=1" size="sm" icon={<Plus className="size-4" aria-hidden />}>
              Novo paciente
            </ButtonLink>
            <ButtonLink to="/capture" size="sm" variant="secondary" icon={<Camera className="size-4" aria-hidden />}>
              Iniciar captura
            </ButtonLink>
            <ButtonLink to="/simulations" size="sm" variant="secondary" icon={<Box className="size-4" aria-hidden />}>
              Simulações
            </ButtonLink>
          </div>
        </Card>
      </div>

      {d && d.recent.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Atividade recente" />
          <ul className="divide-y divide-line">
            {d.recent.map((r, i) => (
              <li key={i}>
                <Link to={`/patients/${r.patientId}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-subtle/60">
                  <span>
                    <span className="block font-medium">{r.patientName}</span>
                    <span className="text-xs text-muted">{r.kind === 'CAPTURE' ? 'Captura facial' : 'Simulação'}</span>
                  </span>
                  <span className="text-xs text-muted">{formatDateTime(r.at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Pacientes recentes" action={<Link to="/patients" className="text-sm font-medium text-accent hover:underline">Ver todos</Link>} />
        {recent.isPending ? (
          <Loading />
        ) : recent.isError ? (
          <ErrorState error={recent.error} onRetry={() => recent.refetch()} />
        ) : recent.data.items.length === 0 ? (
          <EmptyState title="Nenhum paciente ainda" action={<ButtonLink to="/patients?novo=1">Cadastrar paciente</ButtonLink>} />
        ) : (
          <ul className="divide-y divide-line">
            {recent.data.items.map((p) => (
              <li key={p.id}>
                <Link to={`/patients/${p.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-subtle/60">
                  <span>
                    <span className="block font-medium">{p.name}</span>
                    <span className="text-xs text-muted">Atualizado em {formatDate(p.updatedAt)}</span>
                  </span>
                  <ConsentBadge state={p.consentState} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function Stat({ label, value, hint, icon, to }: { label: string; value?: number; hint?: string; icon: ReactNode; to: string }) {
  return (
    <Link to={to} className="rounded-xl border border-line bg-surface p-5 shadow-card transition-colors hover:border-field">
      <div className="flex items-center gap-2 text-sm font-medium text-muted">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value ?? '–'}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Link>
  );
}
