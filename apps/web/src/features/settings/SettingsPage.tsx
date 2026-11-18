import {
  AUDIT_ACTION_LABEL,
  can,
  ClinicUpdate,
  Role,
  ROLE_LABEL,
  UserCreate,
  type AuditEntry,
  type Clinic,
  type Paginated,
  type User,
} from '@sim/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Badge, Card, CardHeader, PageHeader } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { SelectField, TextField } from '../../components/ui/Field';
import { ErrorState, Loading } from '../../components/ui/States';
import { toast } from '../../components/ui/Toaster';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth-store';
import { cn, formatDateTime } from '../../lib/format';

const TABS = [
  { id: 'clinica', label: 'Clínica' },
  { id: 'usuarios', label: 'Usuários', permission: 'users.manage' },
  { id: 'auditoria', label: 'Auditoria', permission: 'audit.read' },
] as const;

export function SettingsPage() {
  const role = useAuth((s) => s.user?.role ?? 'RECEPCAO');
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((t) => !('permission' in t) || can(role, t.permission));
  const current = tabs.find((t) => t.id === params.get('aba'))?.id ?? 'clinica';

  return (
    <>
      <PageHeader title="Configurações" />
      <div role="tablist" aria-label="Seções" className="mb-6 flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={current === t.id}
            onClick={() => setParams({ aba: t.id })}
            className={cn(
              '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium',
              current === t.id ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {current === 'clinica' && <ClinicSection canEdit={can(role, 'clinic.manage')} />}
        {current === 'usuarios' && <UsersSection />}
        {current === 'auditoria' && <AuditSection />}
      </div>
    </>
  );
}

function ClinicSection({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const clinic = useQuery({ queryKey: ['clinic'], queryFn: () => api<Clinic>('/clinic') });
  const save = useMutation({
    mutationFn: (body: ClinicUpdate) => api<Clinic>('/clinic', { method: 'PATCH', body }),
    onSuccess: (c) => qc.setQueryData(['clinic'], c),
  });
  const [draft, setDraft] = useState<{ name: string; retentionDays: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (clinic.isPending) return <Loading />;
  if (clinic.isError) return <ErrorState error={clinic.error} onRetry={() => clinic.refetch()} />;
  const values = draft ?? { name: clinic.data.name, retentionDays: String(clinic.data.retentionDays) };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = ClinicUpdate.safeParse({ name: values.name, retentionDays: Number(values.retentionDays) });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    try {
      await save.mutateAsync(parsed.data);
      setDraft(null);
      toast.ok('Clínica atualizada.');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader title="Dados da clínica" description={canEdit ? undefined : 'Só administradores alteram estes dados.'} />
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 px-5 py-4">
        <TextField label="Nome" value={values.name} disabled={!canEdit} error={errors.name} onChange={(e) => setDraft({ ...values, name: e.target.value })} />
        <TextField
          label="Retenção de fotos e modelos 3D (dias)"
          type="number"
          min={30}
          max={3650}
          value={values.retentionDays}
          disabled={!canEdit}
          error={errors.retentionDays}
          hint="Prazo para apagar os dados biométricos após a última atividade. A rotina automática de expurgo entra na Fase 6."
          onChange={(e) => setDraft({ ...values, retentionDays: e.target.value })}
          className="max-w-[10rem]"
        />
        {canEdit && (
          <div className="flex justify-end">
            <Button type="submit" loading={save.isPending} disabled={!draft}>
              Salvar
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

function UsersSection() {
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; active?: boolean; role?: Role }) =>
      api<User>(`/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
  const [creating, setCreating] = useState(false);

  const change = async (body: Parameters<typeof update.mutateAsync>[0]) => {
    try {
      await update.mutateAsync(body);
      toast.ok('Usuário atualizado.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Card>
      <CardHeader
        title="Usuários da clínica"
        action={
          <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
            Novo usuário
          </Button>
        }
      />
      {users.isPending ? (
        <Loading />
      ) : users.isError ? (
        <ErrorState error={users.error} onRetry={() => users.refetch()} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-faint">
              <tr className="border-b border-line">
                <th scope="col" className="px-5 py-3 font-medium">Nome</th>
                <th scope="col" className="px-5 py-3 font-medium">Papel</th>
                <th scope="col" className="px-5 py-3 font-medium">Situação</th>
                <th scope="col" className="px-5 py-3"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => {
                const self = u.id === me?.id;
                return (
                  <tr key={u.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3">
                      <span className="block font-medium">
                        {u.name} {self && <span className="text-xs font-normal text-faint">(você)</span>}
                      </span>
                      <span className="text-xs text-muted">{u.email}</span>
                    </td>
                    <td className="px-5 py-3">
                      <select
                        aria-label={`Papel de ${u.name}`}
                        value={u.role}
                        disabled={self || update.isPending}
                        onChange={(e) => change({ id: u.id, role: e.target.value as Role })}
                        className="h-8 rounded-md border border-line-strong bg-surface px-2 text-sm disabled:bg-subtle"
                      >
                        {Role.options.map((r) => (
                          <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-5 py-3">{u.active ? <Badge tone="ok">Ativo</Badge> : <Badge>Inativo</Badge>}</td>
                    <td className="px-5 py-3 text-right">
                      {!self && (
                        <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => change({ id: u.id, active: !u.active })}>
                          {u.active ? 'Desativar' : 'Reativar'}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <NewUserDialog open={creating} onClose={() => setCreating(false)} />
    </Card>
  );
}

function NewUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ name: '', email: '', password: '', role: 'RECEPCAO' as Role });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: (body: UserCreate) => api<User>('/users', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = UserCreate.safeParse(v);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    try {
      await create.mutateAsync(parsed.data);
      toast.ok('Usuário criado.');
      setV({ name: '', email: '', password: '', role: 'RECEPCAO' });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setErrors({ email: 'Já existe um usuário com este e-mail' });
      else toast.error(errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Novo usuário" description="A pessoa entra com este e-mail e a senha inicial.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextField label="Nome" value={v.name} error={errors.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        <TextField label="E-mail" type="email" value={v.email} error={errors.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        <TextField label="Senha inicial" type="password" autoComplete="new-password" value={v.password} error={errors.password} hint="Ao menos 10 caracteres." onChange={(e) => setV({ ...v, password: e.target.value })} />
        <SelectField label="Papel" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as Role })}>
          {Role.options.map((r) => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </SelectField>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={create.isPending}>Criar usuário</Button>
        </div>
      </form>
    </Dialog>
  );
}

function AuditSection() {
  const [page, setPage] = useState(1);
  const audit = useQuery({
    queryKey: ['audit', page],
    queryFn: () => api<Paginated<AuditEntry>>('/audit', { query: { page, pageSize: 25 } }),
  });
  if (audit.isPending) return <Loading />;
  if (audit.isError) return <ErrorState error={audit.error} onRetry={() => audit.refetch()} />;
  const pages = Math.max(1, Math.ceil(audit.data.total / 25));
  return (
    <Card>
      <CardHeader title="Registro de auditoria" description="Acessos e alterações em dados sensíveis desta clínica." />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-faint">
            <tr className="border-b border-line">
              <th scope="col" className="px-5 py-3 font-medium">Quando</th>
              <th scope="col" className="px-5 py-3 font-medium">Ação</th>
              <th scope="col" className="px-5 py-3 font-medium">Quem</th>
              <th scope="col" className="px-5 py-3 font-medium">IP</th>
            </tr>
          </thead>
          <tbody>
            {audit.data.items.map((a) => (
              <tr key={a.id} className="border-b border-line last:border-0">
                <td className="whitespace-nowrap px-5 py-2.5 text-muted">{formatDateTime(a.createdAt)}</td>
                <td className="px-5 py-2.5">{AUDIT_ACTION_LABEL[a.action] ?? a.action}</td>
                <td className="px-5 py-2.5">{a.user?.name ?? '—'}</td>
                <td className="px-5 py-2.5 font-mono text-xs text-muted">{a.ip ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3 text-sm text-muted">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
        <span>{page} de {pages}</span>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima</Button>
      </div>
    </Card>
  );
}
