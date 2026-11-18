import { LOGO_MAX_BYTES, type Clinic, type SupportAccessEntry } from '@sim/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageUp, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Badge, Card, CardHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, Loading } from '../../components/ui/States';
import { toast } from '../../components/ui/Toaster';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useClinicLogo } from '../../lib/use-clinic-logo';

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Não foi possível ler o arquivo'));
    r.readAsDataURL(file);
  });

/** Logo da clínica: PNG ou JPEG de até 400 KB. Aparece no menu para toda a equipe. */
export function LogoCard({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const clinic = useQuery({ queryKey: ['clinic'], queryFn: () => api<Clinic>('/clinic') });
  const logo = useClinicLogo(clinic.data?.hasLogo ?? false);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['clinic'] });
    void qc.invalidateQueries({ queryKey: ['clinic-logo'] });
  };
  const remove = useMutation({
    mutationFn: () => api<void>('/clinic/logo', { method: 'DELETE' }),
    onSuccess: refresh,
  });

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) return toast.error('Use uma imagem PNG ou JPEG.');
    if (file.size > LOGO_MAX_BYTES) return toast.error('O logo precisa ter até 400 KB.');
    setBusy(true);
    try {
      await api<Clinic>('/clinic/logo', { method: 'PUT', body: { dataUrl: await readDataUrl(file) } });
      refresh();
      toast.ok('Logo atualizado.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <Card className="mt-6 max-w-2xl">
      <CardHeader title="Logo da clínica" description="Aparece no menu para toda a equipe. PNG ou JPEG, até 400 KB." />
      <div className="flex flex-wrap items-center gap-5 px-5 py-4">
        <div className="flex size-20 items-center justify-center overflow-hidden rounded-xl border border-line bg-subtle">
          {logo ? <img src={logo} alt="Logo atual da clínica" className="size-full object-contain" /> : <span className="px-2 text-center text-xs text-muted">Sem logo</span>}
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <input ref={input} type="file" accept="image/png,image/jpeg" className="sr-only" aria-label="Escolher arquivo de logo" onChange={(e) => void onFile(e.target.files?.[0])} />
            <Button variant="secondary" loading={busy} icon={<ImageUp className="size-4" aria-hidden />} onClick={() => input.current?.click()}>
              {logo ? 'Trocar logo' : 'Enviar logo'}
            </Button>
            {logo && (
              <Button variant="ghost" loading={remove.isPending} icon={<Trash2 className="size-4" aria-hidden />} onClick={() => remove.mutate(undefined, { onError: (e) => toast.error(errorMessage(e)) })}>
                Remover
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted">Só a dona e a gerência alteram o logo.</p>
        )}
      </div>
    </Card>
  );
}

/** Quem do suporte da plataforma entrou na clínica, quando e por quê (transparência para a dona). */
export function SupportAccessCard() {
  const list = useQuery({ queryKey: ['support-access'], queryFn: () => api<SupportAccessEntry[]>('/clinic/support-access') });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <Card className="mb-6">
      <CardHeader
        title="Acessos do suporte da plataforma"
        description="O suporte só entra com motivo escrito, por tempo limitado e só para consultar (sem fotos nem modelos 3D)."
      />
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState title="Nenhum acesso do suporte" description="Se alguém do suporte entrar nesta clínica, aparece aqui." />
      ) : (
        <ul className="divide-y divide-line">
          {list.data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
              <span className="min-w-0">
                <span className="block font-medium">{s.admin.name}</span>
                <span className="block text-sm text-muted">{s.reason}</span>
                <span className="block text-xs text-faint">
                  {formatDateTime(s.startedAt)} até {formatDateTime(s.endedAt ?? s.expiresAt)}
                </span>
              </span>
              {s.active && new Date(s.expiresAt).getTime() > now ? <Badge tone="warn">Ativo agora</Badge> : <Badge>Encerrado</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
