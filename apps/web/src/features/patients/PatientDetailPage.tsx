import { can, CONSENT_SCOPE_INFO, SIGNER_RELATION_LABEL, type Consent } from '@sim/contracts';
import { ChevronLeft, Eye, FileSignature, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Badge, Card, CardHeader } from '../../components/ui/Card';
import { ConfirmDialog, Dialog } from '../../components/ui/Dialog';
import { EmptyState, ErrorState, Loading } from '../../components/ui/States';
import { toast } from '../../components/ui/Toaster';
import { errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth-store';
import { formatDate, formatDateTime } from '../../lib/format';
import { ConsentBadge } from './ConsentBadge';
import { PatientTimeline } from '../product/PatientTimeline';
import { PatientHistory } from './PatientHistory';
import { PatientForm } from './PatientForm';
import {
  fetchSignature,
  useConsents,
  useDeletePatient,
  usePatient,
  useRevokeConsent,
  useUpdatePatient,
} from './queries';

export function PatientDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const role = useAuth((s) => s.user?.role ?? 'RECEPCAO');
  const patient = usePatient(id);
  const consents = useConsents(id);
  const update = useUpdatePatient(id);
  const remove = useDeletePatient();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (patient.isPending) return <Loading />;
  if (patient.isError) {
    return (
      <div>
        <BackLink />
        <ErrorState error={patient.error} onRetry={() => patient.refetch()} />
      </div>
    );
  }
  const p = patient.data;

  return (
    <>
      <BackLink />
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
            <ConsentBadge state={p.consentState} />
          </div>
          <p className="mt-1 text-sm text-muted">Cadastrado em {formatDate(p.createdAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setEditing(true)}>
            Editar
          </Button>
          {can(role, 'patients.delete') && (
            <Button variant="secondary" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setDeleting(true)}>
              Excluir
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader title="Dados" />
          <dl className="grid gap-4 px-5 py-4 text-sm">
            <Info label="Código interno" value={p.internalCode} />
            <Info label="Telefone" value={p.phone} />
            <Info label="Data de nascimento" value={p.birthDate && formatDate(p.birthDate)} />
            <Info label="Observações" value={p.notes} multiline />
          </dl>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader
              title="Termo de consentimento"
              description="Sem termo ativo, a captura de fotos fica bloqueada."
              action={
                can(role, 'consents.write') && (
                  <ButtonLink to={`/patients/${p.id}/consent`} icon={<FileSignature className="size-4" aria-hidden />} size="sm">
                    {p.consentState === 'ACTIVE' ? 'Assinar novo termo' : 'Assinar termo'}
                  </ButtonLink>
                )
              }
            />
            {consents.isPending ? (
              <Loading />
            ) : consents.isError ? (
              <ErrorState error={consents.error} onRetry={() => consents.refetch()} />
            ) : consents.data.length === 0 ? (
              <EmptyState title="Nenhum termo assinado" description="Colha o termo antes da primeira captura." />
            ) : (
              <ul className="divide-y divide-line">
                {consents.data.map((c) => (
                  <ConsentRow key={c.id} consent={c} canRevoke={can(role, 'consents.revoke')} />
                ))}
              </ul>
            )}
          </Card>

          <PatientHistory patient={p} />
          <PatientTimeline patientId={p.id} />
        </div>
      </div>

      <Dialog open={editing} onClose={() => setEditing(false)} title="Editar paciente" size="lg">
        <PatientForm
          initial={p}
          submitLabel="Salvar"
          onCancel={() => setEditing(false)}
          onSubmit={async (v) => {
            // Campo apagado no formulário = apagar no cadastro.
            await update.mutateAsync({
              name: v.name,
              internalCode: v.internalCode ?? null,
              phone: v.phone ?? null,
              birthDate: v.birthDate ?? null,
              notes: v.notes ?? null,
            });
            setEditing(false);
            toast.ok('Dados atualizados.');
          }}
        />
      </Dialog>

      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Excluir paciente?"
        confirmLabel="Excluir definitivamente"
        loading={remove.isPending}
        description={
          <div className="space-y-2">
            <p>
              Fotos, modelos 3D e simulações de <strong className="text-ink">{p.name}</strong> serão apagados de forma
              permanente. O cadastro é anonimizado.
            </p>
            <p>Os registros dos termos assinados ficam guardados como comprovação. Esta ação não pode ser desfeita.</p>
          </div>
        }
        onConfirm={async () => {
          try {
            await remove.mutateAsync(p.id);
            toast.ok('Paciente excluído.');
            navigate('/patients');
          } catch (e) {
            toast.error(errorMessage(e));
            setDeleting(false);
          }
        }}
      />
    </>
  );
}

function BackLink() {
  return (
    <Link to="/patients" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
      <ChevronLeft className="size-4" aria-hidden /> Pacientes
    </Link>
  );
}

function Info({ label, value, multiline }: { label: string; value: string | null; multiline?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-faint">{label}</dt>
      <dd className={multiline ? 'mt-1 whitespace-pre-wrap' : 'mt-1'}>{value || <span className="text-faint">—</span>}</dd>
    </div>
  );
}

function ConsentRow({ consent: c, canRevoke }: { consent: Consent; canRevoke: boolean }) {
  const revoke = useRevokeConsent();
  const [confirming, setConfirming] = useState(false);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [loadingSig, setLoadingSig] = useState(false);

  useEffect(() => () => {
    if (signatureUrl) URL.revokeObjectURL(signatureUrl);
  }, [signatureUrl]);

  async function showSignature() {
    setLoadingSig(true);
    try {
      setSignatureUrl(URL.createObjectURL(await fetchSignature(c.id)));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoadingSig(false);
    }
  }

  const active = c.revokedAt === null;
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {active ? <Badge tone="ok">Ativo</Badge> : <Badge>Revogado em {formatDateTime(c.revokedAt!)}</Badge>}
            <span className="text-xs text-faint">Termo {c.termVersion}</span>
          </div>
          <p className="text-sm">
            Assinado por <strong>{c.signerName}</strong> ({SIGNER_RELATION_LABEL[c.signerRelation].toLowerCase()}) em{' '}
            {formatDateTime(c.signedAt)}
          </p>
          <p className="text-xs text-muted">Colhido por {c.collectedBy.name}</p>
          <ul className="flex flex-wrap gap-1.5 pt-1">
            {c.scopes.map((s) => (
              <li key={s}>
                <Badge tone={s === 'SIMULATION' ? 'accent' : 'neutral'}>{CONSENT_SCOPE_INFO[s].label}</Badge>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" icon={<Eye className="size-4" aria-hidden />} loading={loadingSig} onClick={showSignature}>
            Assinatura
          </Button>
          {active && canRevoke && (
            <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
              Revogar
            </Button>
          )}
        </div>
      </div>

      <Dialog open={signatureUrl !== null} onClose={() => setSignatureUrl(null)} title="Assinatura" description={`${c.signerName} · ${formatDateTime(c.signedAt)}`}>
        {signatureUrl && <img src={signatureUrl} alt={`Assinatura de ${c.signerName}`} className="w-full rounded-lg border border-line bg-white" />}
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Revogar termo?"
        confirmLabel="Revogar e apagar dados"
        loading={revoke.isPending}
        description={
          c.scopes.includes('SIMULATION') ? (
            <p>
              Sem termo ativo, as fotos, os modelos 3D e as simulações deste paciente são <strong className="text-ink">apagados
              de forma permanente</strong>. O registro do termo e da revogação continua guardado.
            </p>
          ) : (
            <p>O termo deixa de valer a partir de agora.</p>
          )
        }
        onConfirm={async () => {
          try {
            const r = await revoke.mutateAsync(c.id);
            toast.ok(r.biometricsPurged ? 'Termo revogado. Dados biométricos apagados.' : 'Termo revogado.');
          } catch (e) {
            toast.error(errorMessage(e));
          } finally {
            setConfirming(false);
          }
        }}
      />
    </li>
  );
}
