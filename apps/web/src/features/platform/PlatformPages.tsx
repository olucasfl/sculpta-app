import {
  PlatformClinicCreate,
  ROLE_LABEL,
  type Paginated,
  type PlatformAccount,
  type PlatformClinic,
  type PlatformClinicDetail,
  type PlatformMetrics,
} from '@sim/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronLeft, Plus, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Badge, Card, CardHeader, PageHeader } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { TextField } from '../../components/ui/Field';
import { EmptyState, ErrorState, Loading } from '../../components/ui/States';
import { toast } from '../../components/ui/Toaster';
import { api, ApiError, errorMessage } from '../../lib/api';
import { formatDate, formatDateTime } from '../../lib/format';

const STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' }> = {
  ACTIVE: { label: 'Ativa', tone: 'ok' },
  SUSPENDED: { label: 'Suspensa', tone: 'warn' },
  PENDING_DELETION: { label: 'Exclusão agendada', tone: 'danger' },
};

const ClinicStatusBadge = ({ status }: { status: string }) => (
  <Badge tone={STATUS[status]?.tone ?? 'neutral'}>{STATUS[status]?.label ?? status}</Badge>
);

/** Visão geral do console: métricas e lista de clínicas. */
export function PlatformHomePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const metrics = useQuery({ queryKey: ['platform', 'metrics'], queryFn: () => api<PlatformMetrics>('/platform/metrics') });
  const clinics = useQuery({
    queryKey: ['platform', 'clinics', search],
    queryFn: () => api<Paginated<PlatformClinic>>('/platform/clinics', { query: { search: search || undefined, pageSize: 50 } }),
  });

  return (
    <>
      <PageHeader
        title="Plataforma"
        description="Clínicas, contas e uso. Você não vê dados de pacientes aqui."
        action={
          <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
            Nova clínica
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Clínicas ativas" value={metrics.data?.clinics.active} hint={metrics.data && `${metrics.data.clinics.total} no total`} />
        <Stat label="Contas" value={metrics.data?.accounts.total} hint={metrics.data && `${metrics.data.accounts.platformAdmins} administrador(es)`} />
        <Stat label="Pacientes (todas as clínicas)" value={metrics.data?.patients} />
        <Stat label="Convites pendentes" value={metrics.data?.pendingInvitations} hint={metrics.data && `${metrics.data.reconstructions.failed} reconstrução(ões) com falha`} />
      </div>

      <Card>
        <CardHeader
          title="Clínicas"
          action={
            <label className="relative block min-w-0 sm:w-64">
              <span className="sr-only">Buscar clínica</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome"
                className="h-11 w-full rounded-lg border border-field bg-surface pl-9 pr-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </label>
          }
        />
        {clinics.isPending ? (
          <Loading />
        ) : clinics.isError ? (
          <ErrorState error={clinics.error} onRetry={() => clinics.refetch()} />
        ) : clinics.data.items.length === 0 ? (
          <EmptyState icon={<Building2 className="size-5" />} title="Nenhuma clínica" description="Crie a primeira clínica e convide a dona pelo e-mail." action={<Button onClick={() => setCreating(true)}>Nova clínica</Button>} />
        ) : (
          <>
            <ul className="divide-y divide-line md:hidden">
              {clinics.data.items.map((c) => (
                <li key={c.id}>
                  <Link to={`/plataforma/clinicas/${c.id}`} className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 hover:bg-subtle/60">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="block truncate text-sm text-muted">{c.members} pessoa(s) · {c.patients} paciente(s)</span>
                    </span>
                    <ClinicStatusBadge status={c.status} />
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-faint">
                  <tr className="border-b border-line">
                    <th scope="col" className="px-5 py-3 font-medium">Clínica</th>
                    <th scope="col" className="px-5 py-3 font-medium">Situação</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Pessoas</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Pacientes</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Convites</th>
                    <th scope="col" className="px-5 py-3 font-medium">Criada em</th>
                  </tr>
                </thead>
                <tbody>
                  {clinics.data.items.map((c) => (
                    <tr key={c.id} className="border-b border-line last:border-0 hover:bg-subtle/60">
                      <td className="px-5 py-3">
                        <Link to={`/plataforma/clinicas/${c.id}`} className="inline-flex min-h-11 items-center font-medium hover:text-accent">
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3"><ClinicStatusBadge status={c.status} /></td>
                      <td className="px-5 py-3 text-right tabular-nums">{c.members}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{c.patients}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{c.pendingInvitations}</td>
                      <td className="px-5 py-3 text-muted">{formatDate(c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <NewClinicDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          void qc.invalidateQueries({ queryKey: ['platform'] });
          navigate(`/plataforma/clinicas/${id}`);
        }}
      />
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value?: number; hint?: string }) {
  return (
    <Card className="p-5">
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value ?? '—'}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </Card>
  );
}

function NewClinicDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [v, setV] = useState({ name: '', cnpj: '', ownerEmail: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: (body: PlatformClinicCreate) => api<PlatformClinicDetail>('/platform/clinics', { method: 'POST', body }),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = PlatformClinicCreate.safeParse(v);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    try {
      const c = await create.mutateAsync(parsed.data);
      toast.ok('Clínica criada. A dona entra ao criar a conta com o e-mail informado.');
      setV({ name: '', cnpj: '', ownerEmail: '' });
      onClose();
      onCreated(c.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setErrors(err.fieldErrors());
      else toast.error(errorMessage(err));
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nova clínica"
      description="A dona recebe um convite pelo e-mail: ao criar a conta (ou entrar) com ele, ela cai na clínica."
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextField label="Nome da clínica" value={v.name} error={errors.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus />
        <TextField label="CNPJ" optional value={v.cnpj} error={errors.cnpj} onChange={(e) => setV({ ...v, cnpj: e.target.value })} />
        <TextField label="E-mail da dona" type="email" value={v.ownerEmail} error={errors.ownerEmail} onChange={(e) => setV({ ...v, ownerEmail: e.target.value })} />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={create.isPending}>Criar clínica</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Detalhe da clínica: equipe, convites e ações (suspender, reativar, agendar exclusão). */
export function PlatformClinicPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform', 'clinic', id], queryFn: () => api<PlatformClinicDetail>(`/platform/clinics/${id}`) });
  const [deleting, setDeleting] = useState(false);
  const [confirmName, setConfirmName] = useState('');

  const act = useMutation({
    mutationFn: (a: { path: string; method?: 'POST' | 'DELETE'; body?: unknown }) =>
      api<PlatformClinicDetail>(`/platform/clinics/${id}${a.path}`, { method: a.method ?? 'POST', body: a.body }),
    onSuccess: (c) => {
      qc.setQueryData(['platform', 'clinic', id], c);
      void qc.invalidateQueries({ queryKey: ['platform', 'clinics'] });
    },
  });
  const run = async (a: Parameters<typeof act.mutateAsync>[0], ok: string) => {
    try {
      await act.mutateAsync(a);
      toast.ok(ok);
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    }
  };

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data;

  return (
    <>
      <Link to="/plataforma" className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden /> Clínicas
      </Link>
      <PageHeader
        title={c.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <ClinicStatusBadge status={c.status} />
            <span>{c.members} pessoa(s) · {c.patients} paciente(s) · criada em {formatDate(c.createdAt)}</span>
          </span>
        }
        action={
          <div className="flex flex-wrap gap-2">
            {c.status === 'ACTIVE' && (
              <Button variant="secondary" loading={act.isPending} onClick={() => run({ path: '/suspend' }, 'Clínica suspensa.')}>
                Suspender
              </Button>
            )}
            {c.status === 'SUSPENDED' && (
              <Button loading={act.isPending} onClick={() => run({ path: '/reactivate' }, 'Clínica reativada.')}>
                Reativar
              </Button>
            )}
            {c.status === 'PENDING_DELETION' ? (
              <Button variant="secondary" loading={act.isPending} onClick={() => run({ path: '/deletion', method: 'DELETE' }, 'Exclusão cancelada.')}>
                Cancelar exclusão
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setDeleting(true)}>
                Agendar exclusão
              </Button>
            )}
          </div>
        }
      />

      {c.status === 'PENDING_DELETION' && (
        <p role="status" className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          Exclusão agendada{c.deletionScheduledAt ? ` para ${formatDateTime(c.deletionScheduledAt)}` : ''}. A equipe já está bloqueada. O expurgo
          automático dos dados ainda não existe: até ele ser implementado, nada é apagado.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Equipe" />
          {c.team.length === 0 ? (
            <EmptyState title="Ninguém ainda" description="A dona entra quando criar a conta com o e-mail convidado." />
          ) : (
            <ul className="divide-y divide-line">
              {c.team.map((m) => (
                <li key={m.userId} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{m.name}</span>
                    <span className="block truncate text-sm text-muted">{m.email}</span>
                    <span className="block text-xs text-faint">{m.lastLoginAt ? `Último acesso ${formatDateTime(m.lastLoginAt)}` : 'Nunca acessou'}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <Badge tone="accent">{ROLE_LABEL[m.role]}</Badge>
                    {m.status !== 'ACTIVE' && <Badge tone="warn">Suspenso</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Convites" description="O convite vale para quem criar conta (ou entrar) com este e-mail." />
          {c.invitations.length === 0 ? (
            <EmptyState title="Nenhum convite" />
          ) : (
            <ul className="divide-y divide-line">
              {c.invitations.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{i.email}</span>
                    <span className="block text-sm text-muted">{ROLE_LABEL[i.role]} · vale até {formatDate(i.expiresAt)}</span>
                  </span>
                  <Badge tone={i.status === 'PENDING' ? 'warn' : i.status === 'ACCEPTED' ? 'ok' : 'neutral'}>
                    {({ PENDING: 'Pendente', ACCEPTED: 'Aceito', REVOKED: 'Revogado', EXPIRED: 'Vencido' } as Record<string, string>)[i.status] ?? i.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Dialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Agendar exclusão da clínica"
        description="A equipe é bloqueada agora. Há 30 dias de carência, e você pode cancelar nesse prazo. Digite o nome da clínica para confirmar."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(false)}>Cancelar</Button>
            <Button
              variant="danger"
              loading={act.isPending}
              disabled={confirmName !== c.name}
              onClick={async () => {
                if (await run({ path: '/deletion', body: { confirmName } }, 'Exclusão agendada.')) {
                  setDeleting(false);
                  setConfirmName('');
                }
              }}
            >
              Agendar exclusão
            </Button>
          </>
        }
      >
        <TextField label={`Digite “${c.name}”`} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
      </Dialog>
    </>
  );
}

/** Contas do sistema, com os vínculos de cada uma. */
export function PlatformAccountsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['platform', 'accounts', search],
    queryFn: () => api<Paginated<PlatformAccount>>('/platform/accounts', { query: { search: search || undefined, pageSize: 50 } }),
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api<void>(`/platform/accounts/${id}/${active ? 'reactivate' : 'suspend'}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'accounts'] }),
  });

  return (
    <>
      <PageHeader title="Contas" description="Todas as contas e as clínicas em que cada uma tem acesso." />
      <Card>
        <div className="border-b border-line p-4">
          <label className="relative block max-w-md">
            <span className="sr-only">Buscar conta</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou e-mail"
              className="h-11 w-full rounded-lg border border-field bg-surface pl-9 pr-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </label>
        </div>
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.data.items.length === 0 ? (
          <EmptyState title="Nenhuma conta encontrada" />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.items.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.name}</span>
                    {a.isPlatformAdmin && <Badge tone="accent">Admin da plataforma</Badge>}
                    {!a.active && <Badge tone="danger">Suspensa</Badge>}
                  </span>
                  <span className="block text-sm text-muted">{a.email}</span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {a.clinics.length === 0 ? (
                      <span className="text-xs text-faint">Sem clínica</span>
                    ) : (
                      a.clinics.map((c) => (
                        <Link key={c.id} to={`/plataforma/clinicas/${c.id}`} className="rounded-full bg-subtle px-2 py-0.5 text-xs text-muted hover:text-ink">
                          {c.name} · {ROLE_LABEL[c.role]}
                        </Link>
                      ))
                    )}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={toggle.isPending && toggle.variables?.id === a.id}
                  onClick={async () => {
                    try {
                      await toggle.mutateAsync({ id: a.id, active: !a.active });
                      toast.ok(a.active ? 'Conta suspensa.' : 'Conta reativada.');
                    } catch (e) {
                      toast.error(errorMessage(e));
                    }
                  }}
                >
                  {a.active ? 'Suspender' : 'Reativar'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
