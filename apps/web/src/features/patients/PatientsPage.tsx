import { ChevronLeft, ChevronRight, Plus, Search, Users } from 'lucide-react';
import { can, type User } from '@sim/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Card, PageHeader } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState, ErrorState, Loading } from '../../components/ui/States';
import { toast } from '../../components/ui/Toaster';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth-store';
import { cn, formatDate } from '../../lib/format';
import { ConsentBadge } from './ConsentBadge';
import { PatientForm } from './PatientForm';
import { useCreatePatient, usePatients } from './queries';

const PAGE_SIZE = 20;

export function PatientsPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const consent = (params.get('termo') as 'active' | 'pending' | null) ?? undefined;
  const page = Number(params.get('p') ?? 1);
  const createdFrom = params.get('de') ?? undefined;
  const createdTo = params.get('ate') ?? undefined;
  const professionalId = params.get('prof') ?? undefined;
  const role = useAuth((s) => s.user?.role ?? 'RECEPCAO');
  const team = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users'), enabled: can(role, 'members.read') });
  const setParam = (key: string, value?: string) =>
    setParams((p) => {
      if (value) p.set(key, value);
      else p.delete(key);
      p.delete('p');
      return p;
    });
  const [term, setTerm] = useState(search);
  const [creating, setCreating] = useState(params.get('novo') === '1');
  const navigate = useNavigate();
  const create = useCreatePatient();

  // Busca com atraso curto para não disparar uma requisição por tecla.
  useEffect(() => {
    const t = setTimeout(() => {
      if (term === search) return;
      setParams((p) => {
        if (term) p.set('q', term);
        else p.delete('q');
        p.delete('p');
        return p;
      });
    }, 300);
    return () => clearTimeout(t);
  }, [term, search, setParams]);

  const q = usePatients({ search: search || undefined, page, pageSize: PAGE_SIZE, consent, createdFrom, createdTo, professionalId });
  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / PAGE_SIZE)) : 1;

  const setFilter = (value?: 'active' | 'pending') =>
    setParams((p) => {
      if (value) p.set('termo', value);
      else p.delete('termo');
      p.delete('p');
      return p;
    });
  const goTo = (n: number) => setParams((p) => (p.set('p', String(n)), p));

  return (
    <>
      <PageHeader
        title="Pacientes"
        description="Cadastro mínimo, termo de consentimento e histórico."
        action={
          <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
            Novo paciente
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="relative min-w-0 flex-1 basis-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <input
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Buscar por nome ou código interno"
              aria-label="Buscar pacientes"
              className="h-11 w-full rounded-lg border border-field bg-surface pl-9 pr-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div role="group" aria-label="Filtrar por termo" className="flex gap-1 rounded-lg bg-subtle p-1">
            {([
              [undefined, 'Todos'],
              ['pending', 'Sem termo'],
              ['active', 'Com termo'],
            ] as const).map(([value, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={consent === value}
                onClick={() => setFilter(value)}
                className={cn(
                  'min-h-10 rounded-md px-3 text-sm font-medium',
                  consent === value ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              Cadastrado de
              <input type="date" value={createdFrom ?? ''} onChange={(e) => setParam('de', e.target.value)} className="h-11 rounded-lg border border-field bg-surface px-2 text-sm text-ink" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              até
              <input type="date" value={createdTo ?? ''} onChange={(e) => setParam('ate', e.target.value)} className="h-11 rounded-lg border border-field bg-surface px-2 text-sm text-ink" />
            </label>
            {can(role, 'members.read') && team.data && (
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                Profissional
                <select value={professionalId ?? ''} onChange={(e) => setParam('prof', e.target.value)} className="h-11 rounded-lg border border-field bg-surface px-2 text-sm text-ink">
                  <option value="">Todos</option>
                  {team.data.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </label>
            )}
            {(createdFrom || createdTo || professionalId) && (
              <Button variant="ghost" size="sm" onClick={() => setParams((p) => (p.delete('de'), p.delete('ate'), p.delete('prof'), p.delete('p'), p))}>
                Limpar filtros
              </Button>
            )}
          </div>
        </div>

        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.data.items.length === 0 ? (
          search || consent || createdFrom || createdTo || professionalId ? (
            <EmptyState icon={<Search className="size-5" />} title="Nenhum paciente encontrado" description="Tente outro nome, código ou filtro." />
          ) : (
            <EmptyState
              icon={<Users className="size-5" />}
              title="Nenhum paciente ainda"
              description="Cadastre o primeiro paciente para registrar o termo e, nas próximas fases, as capturas."
              action={<Button onClick={() => setCreating(true)}>Cadastrar paciente</Button>}
            />
          )
        ) : (
          <>
            {/* Abaixo de 768 px cada linha vira um cartão */}
            <ul className="divide-y divide-line md:hidden">
              {q.data.items.map((p) => (
                <li key={p.id}>
                  <Link to={`/patients/${p.id}`} className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 hover:bg-subtle/60">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{p.name}</span>
                      <span className="block truncate text-sm text-muted">
                        {p.internalCode ? <span className="font-mono">{p.internalCode}</span> : 'Sem código'} · {formatDate(p.updatedAt)}
                      </span>
                    </span>
                    <ConsentBadge state={p.consentState} />
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-faint">
                  <tr className="border-b border-line">
                    <th scope="col" className="px-5 py-3 font-medium">Nome</th>
                    <th scope="col" className="px-5 py-3 font-medium">Código</th>
                    <th scope="col" className="px-5 py-3 font-medium">Termo</th>
                    <th scope="col" className="px-5 py-3 font-medium">Atualizado</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.items.map((p) => (
                    <tr key={p.id} className="border-b border-line last:border-0 hover:bg-subtle/60">
                      <td className="px-5 py-3">
                        <Link to={`/patients/${p.id}`} className="inline-flex min-h-11 items-center font-medium text-ink hover:text-accent">
                          {p.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3 font-mono text-muted">{p.internalCode ?? '—'}</td>
                      <td className="px-5 py-3">
                        <ConsentBadge state={p.consentState} />
                      </td>
                      <td className="px-5 py-3 text-muted">{formatDate(p.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm text-muted">
              <span>
                {q.data.total} paciente{q.data.total === 1 ? '' : 's'}
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => goTo(page - 1)} aria-label="Página anterior">
                    <ChevronLeft className="size-4" aria-hidden />
                  </Button>
                  <span>
                    {page} de {totalPages}
                  </span>
                  <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => goTo(page + 1)} aria-label="Próxima página">
                    <ChevronRight className="size-4" aria-hidden />
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </Card>

      <Dialog open={creating} onClose={() => setCreating(false)} title="Novo paciente" size="lg">
        <PatientForm
          submitLabel="Cadastrar"
          onCancel={() => setCreating(false)}
          onSubmit={async (values) => {
            const p = await create.mutateAsync(values);
            setCreating(false);
            toast.ok('Paciente cadastrado.');
            navigate(`/patients/${p.id}`);
          }}
        />
      </Dialog>
    </>
  );
}
