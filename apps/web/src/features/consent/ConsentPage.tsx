import {
  CONSENT_SCOPE_INFO,
  ConsentCreate,
  ConsentScope,
  CURRENT_TERM,
  SIGNER_RELATION_LABEL,
  SignerRelation,
} from '@sim/contracts';
import { ChevronLeft } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Badge, Card } from '../../components/ui/Card';
import { SelectField, TextField } from '../../components/ui/Field';
import { ErrorState, Loading } from '../../components/ui/States';
import { toast } from '../../components/ui/Toaster';
import { errorMessage } from '../../lib/api';
import { usePatient, useSignConsent } from '../patients/queries';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';

export function ConsentPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const patient = usePatient(id);
  const sign = useSignConsent(id);
  const pad = useRef<SignaturePadHandle>(null);
  const sigLabel = useId();

  const [scopes, setScopes] = useState<ConsentScope[]>([]);
  const [signerName, setSignerName] = useState('');
  const [signerRelation, setSignerRelation] = useState<SignerRelation>('PACIENTE');
  const [hasInk, setHasInk] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (patient.data && signerRelation === 'PACIENTE') setSignerName(patient.data.name);
  }, [patient.data, signerRelation]);

  if (patient.isPending) return <Loading />;
  if (patient.isError) return <ErrorState error={patient.error} onRetry={() => patient.refetch()} />;

  const toggle = (s: ConsentScope) =>
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!hasInk) next.signature = 'Colha a assinatura';
    const parsed = ConsentCreate.safeParse({
      termVersion: CURRENT_TERM.version,
      scopes,
      signerName,
      signerRelation,
      signatureDataUrl: hasInk ? pad.current?.toDataUrl() : 'data:image/png;base64,',
    });
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        const k = String(i.path[0]);
        if (k !== 'signatureDataUrl') next[k] ??= i.message;
      }
    }
    setErrors(next);
    if (Object.keys(next).length > 0 || !parsed.success) return;
    try {
      await sign.mutateAsync(parsed.data);
      toast.ok('Termo assinado.');
      navigate(`/patients/${id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link to={`/patients/${id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden /> {patient.data.name}
      </Link>

      <Card className="overflow-hidden">
        <div className="border-b border-line bg-subtle/60 px-6 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{CURRENT_TERM.title}</h1>
            {CURRENT_TERM.draft && <Badge tone="warn">Texto provisório: validar com o jurídico</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">
            Paciente: <strong className="text-ink">{patient.data.name}</strong> · Versão {CURRENT_TERM.version}
          </p>
        </div>

        <form onSubmit={submit} noValidate>
          <div className="space-y-4 px-6 py-5">
            {CURRENT_TERM.sections.map((s) => (
              <section key={s.heading}>
                <h2 className="font-semibold">{s.heading}</h2>
                <p className="mt-1 text-[15px] leading-relaxed text-muted">{s.body}</p>
              </section>
            ))}
          </div>

          <fieldset className="border-t border-line px-6 py-5">
            <legend className="sr-only">Autorizações</legend>
            <h2 className="mb-3 font-semibold">Autorizações</h2>
            <div className="space-y-3">
              {ConsentScope.options.map((s) => {
                const info = CONSENT_SCOPE_INFO[s];
                return (
                  <label key={s} className="flex cursor-pointer gap-3 rounded-lg border border-line p-3 hover:bg-subtle/60">
                    <input
                      type="checkbox"
                      checked={scopes.includes(s)}
                      onChange={() => toggle(s)}
                      className="mt-1 size-4 accent-[var(--color-accent)]"
                    />
                    <span>
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {info.label}
                        <Badge tone={info.required ? 'accent' : 'neutral'}>{info.required ? 'Obrigatório' : 'Opcional'}</Badge>
                      </span>
                      <span className="mt-0.5 block text-sm text-muted">{info.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {errors.scopes && (
              <p role="alert" className="mt-2 text-sm font-medium text-danger">
                {errors.scopes}
              </p>
            )}
          </fieldset>

          <div className="grid gap-4 border-t border-line px-6 py-5 sm:grid-cols-2">
            <SelectField
              label="Quem assina"
              value={signerRelation}
              onChange={(e) => {
                const v = e.target.value as SignerRelation;
                setSignerRelation(v);
                if (v === 'RESPONSAVEL_LEGAL') setSignerName('');
              }}
            >
              {SignerRelation.options.map((r) => (
                <option key={r} value={r}>
                  {SIGNER_RELATION_LABEL[r]}
                </option>
              ))}
            </SelectField>
            <TextField label="Nome de quem assina" value={signerName} onChange={(e) => setSignerName(e.target.value)} error={errors.signerName} />
            <div className="sm:col-span-2">
              <p id={sigLabel} className="mb-1.5 text-sm font-medium">
                Assinatura
              </p>
              <SignaturePad ref={pad} labelId={sigLabel} onChange={setHasInk} />
              {errors.signature && (
                <p role="alert" className="mt-1 text-sm font-medium text-danger">
                  {errors.signature}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-subtle/60 px-6 py-4">
            <p className="text-xs text-muted">Data, hora, IP e dispositivo são registrados junto com o termo.</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => navigate(`/patients/${id}`)}>
                Cancelar
              </Button>
              <Button type="submit" loading={sign.isPending}>
                Registrar termo
              </Button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}
