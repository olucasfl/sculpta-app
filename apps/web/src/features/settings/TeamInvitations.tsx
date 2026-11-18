import {
  canAssignRole,
  ChangePasswordRequest,
  InvitationCreate,
  Role,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  type ClinicRole,
  type Invitation,
} from '@sim/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Badge, Card, CardHeader } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { SelectField, TextField } from '../../components/ui/Field';
import { MatchHint, PasswordField } from '../../components/ui/PasswordField';
import { EmptyState, ErrorState, Loading } from '../../components/ui/States';
import { toast } from '../../components/ui/Toaster';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth-store';
import { formatDate } from '../../lib/format';

const STATUS: Record<Invitation['status'], { label: string; tone: 'warn' | 'ok' | 'neutral' | 'danger' }> = {
  PENDING: { label: 'Pendente', tone: 'warn' },
  ACCEPTED: { label: 'Aceito', tone: 'ok' },
  REVOKED: { label: 'Revogado', tone: 'neutral' },
  EXPIRED: { label: 'Vencido', tone: 'danger' },
};

/** Convites por e-mail: a pessoa cria a conta (ou entra) com o e-mail convidado e cai na clínica. */
export function InvitationsCard() {
  const myRole = useAuth((s) => s.user?.role);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: ['invitations'], queryFn: () => api<Invitation[]>('/clinic/invitations') });
  const act = useMutation({
    mutationFn: async ({ id, kind }: { id: string; kind: 'resend' | 'revoke' }): Promise<void> => {
      if (kind === 'resend') await api<Invitation>(`/clinic/invitations/${id}/resend`, { method: 'POST' });
      else await api<void>(`/clinic/invitations/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations'] }),
  });
  const run = async (id: string, kind: 'resend' | 'revoke', ok: string) => {
    try {
      await act.mutateAsync({ id, kind });
      toast.ok(ok);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader
        title="Convites"
        description="Avise a pessoa: ela cria a conta (ou entra) com este mesmo e-mail e cai na clínica sozinha. O convite vale por 7 dias."
        action={
          <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
            Convidar por e-mail
          </Button>
        }
      />
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState icon={<Mail className="size-5" />} title="Nenhum convite ainda" description="Convide a equipe pelo e-mail e escolha o papel de cada pessoa." />
      ) : (
        <ul className="divide-y divide-line">
          {list.data.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <span className="min-w-0">
                <span className="block truncate font-medium">{i.email}</span>
                <span className="block text-sm text-muted">
                  {ROLE_LABEL[i.role]} · {i.status === 'PENDING' ? `vale até ${formatDate(i.expiresAt)}` : `criado em ${formatDate(i.createdAt)}`}
                  {i.invitedBy ? ` · por ${i.invitedBy.name}` : ''}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Badge>
                {(i.status === 'PENDING' || i.status === 'EXPIRED') && myRole && canAssignRole(myRole, i.role) && (
                  <Button size="sm" variant="secondary" disabled={act.isPending} onClick={() => run(i.id, 'resend', 'Prazo renovado por 7 dias.')}>
                    Renovar
                  </Button>
                )}
                {i.status === 'PENDING' && myRole && canAssignRole(myRole, i.role) && (
                  <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => run(i.id, 'revoke', 'Convite revogado.')}>
                    Revogar
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <InviteDialog open={open} onClose={() => setOpen(false)} />
    </Card>
  );
}

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const myRole = useAuth((s) => s.user?.role);
  const qc = useQueryClient();
  const allowed = Role.options.filter((r) => myRole && canAssignRole(myRole, r));
  const [v, setV] = useState<{ email: string; role: ClinicRole }>({ email: '', role: 'PROFISSIONAL' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: (body: InvitationCreate) => api<Invitation>('/clinic/invitations', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations'] }),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = InvitationCreate.safeParse(v);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    try {
      await create.mutateAsync(parsed.data);
      toast.ok(`Convite criado. Avise ${parsed.data.email} para criar a conta com este e-mail.`);
      setV({ email: '', role: v.role });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setErrors(err.fieldErrors());
      else setErrors({ email: errorMessage(err) });
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Convidar por e-mail" description="Quando a pessoa criar a conta com este e-mail, entra na clínica com o papel escolhido.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextField label="E-mail" type="email" value={v.email} error={errors.email} onChange={(e) => setV({ ...v, email: e.target.value })} autoFocus />
        <SelectField label="Papel" value={v.role} hint={ROLE_DESCRIPTION[v.role]} onChange={(e) => setV({ ...v, role: e.target.value as ClinicRole })}>
          {allowed.map((r) => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </SelectField>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={create.isPending}>Criar convite</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Trocar a senha da própria conta (encerra as outras sessões). */
export function ChangePasswordCard() {
  const [v, setV] = useState({ currentPassword: '', newPassword: '', confirmNewPassword: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const change = useMutation({
    mutationFn: (body: ChangePasswordRequest) => api<void>('/auth/change-password', { method: 'POST', body }),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = ChangePasswordRequest.safeParse(v);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    try {
      await change.mutateAsync(parsed.data);
      setV({ currentPassword: '', newPassword: '', confirmNewPassword: '' });
      toast.ok('Senha alterada. Os outros aparelhos foram desconectados.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setErrors({ currentPassword: err.message });
      else toast.error(errorMessage(err));
    }
  }

  return (
    <Card className="max-w-xl">
      <CardHeader title="Minha senha" description="Ao trocar, os outros aparelhos em que você está conectado são desconectados." />
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 px-5 py-4">
        <PasswordField label="Senha atual" autoComplete="current-password" value={v.currentPassword} error={errors.currentPassword} onChange={(e) => setV({ ...v, currentPassword: e.target.value })} />
        <PasswordField label="Nova senha" meter autoComplete="new-password" value={v.newPassword} error={errors.newPassword} hint="Ao menos 10 caracteres." onChange={(e) => setV({ ...v, newPassword: e.target.value })} />
        <PasswordField label="Confirme a nova senha" autoComplete="new-password" value={v.confirmNewPassword} error={errors.confirmNewPassword} onChange={(e) => setV({ ...v, confirmNewPassword: e.target.value })} />
        {!errors.confirmNewPassword && <MatchHint a={v.newPassword} b={v.confirmNewPassword} />}
        <div className="flex justify-end">
          <Button type="submit" loading={change.isPending}>Trocar senha</Button>
        </div>
      </form>
    </Card>
  );
}
