import { ANGLE_RULES, PhotoAngle, REQUIRED_ANGLES, type CapturePhoto } from '@sim/contracts';
import { Camera, CheckCircle2, ChevronLeft, Film, ImageUp, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Badge, Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/Dialog';
import { ErrorState, Loading } from '../../components/ui/States';
import { toast } from '../../components/ui/Toaster';
import { errorMessage } from '../../lib/api';
import { cn } from '../../lib/format';
import { usePatient } from '../patients/queries';
import { CameraCapture } from './CameraCapture';
import { CaptureTips } from './CaptureChecks';
import { uploadPhoto, useCaptureActions, useCaptureSession } from './queries';
import type { PendingPhoto } from './types';
import { releaseLandmarkers } from './vision/faceLandmarker';
import { UploadCapture } from './UploadCapture';
import { VideoCapture, type VideoPick } from './VideoCapture';

export function CaptureWizardPage() {
  const { captureId = '' } = useParams();
  const navigate = useNavigate();
  const session = useCaptureSession(captureId);
  const patient = usePatient(session.data?.patientId ?? '');
  const actions = useCaptureActions(captureId);
  const [angle, setAngle] = useState<PhotoAngle | null>(null);
  const [mode, setMode] = useState<'camera' | 'upload' | 'video'>('camera');
  const [pending, setPending] = useState<PendingPhoto | null>(null);
  const [retaking, setRetaking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => () => void releaseLandmarkers(), []);
  useEffect(() => () => {
    if (pending) URL.revokeObjectURL(pending.previewUrl);
  }, [pending]);

  if (session.isPending) return <Loading />;
  if (session.isError) return <ErrorState error={session.error} onRetry={() => session.refetch()} />;
  const s = session.data;
  const byAngle = new Map<PhotoAngle, CapturePhoto>(s.photos.map((p) => [p.angle, p]));
  const firstMissing = PhotoAngle.options.find((a) => !byAngle.has(a)) ?? null;
  const current = angle ?? firstMissing ?? 'FRONT';
  const existing = byAngle.get(current);
  const done = REQUIRED_ANGLES.every((a) => byAngle.has(a));
  const requiredSaved = REQUIRED_ANGLES.filter((a) => byAngle.has(a)).length;
  const extrasSaved = s.photos.length - requiredSaved;
  const missing = PhotoAngle.options.filter((a) => !byAngle.has(a));

  if (s.status !== 'OPEN') {
    return (
      <Card className="mx-auto max-w-lg p-6 text-center">
        <p className="font-medium">Esta sessão de captura já foi {s.status === 'COMPLETED' ? 'concluída' : 'cancelada'}.</p>
        <div className="mt-4 flex justify-center gap-2">
          {s.reconstructions[0] && <Button onClick={() => navigate(`/reconstructions/${s.reconstructions[0]!.id}`)}>Ver modelo 3D</Button>}
          <Button variant="secondary" onClick={() => navigate(`/patients/${s.patientId}`)}>Voltar ao paciente</Button>
        </div>
      </Card>
    );
  }

  async function confirmPending() {
    if (!pending) return;
    setUploading(true);
    try {
      const updated = await uploadPhoto(captureId, current, pending.blob, pending.meta);
      actions.set(updated);
      toast.ok(`${ANGLE_RULES[current].label}: foto salva.`);
      setPending(null);
      setRetaking(false);
      const next = PhotoAngle.options.find((a) => !updated.photos.some((p) => p.angle === a));
      setAngle(next ?? current);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
    }
  }

  async function saveVideoPicks(picks: VideoPick[]) {
    let last = s;
    for (const p of picks) {
      last = await uploadPhoto(captureId, p.angle, p.photo.blob, p.photo.meta);
      actions.set(last);
    }
    toast.ok(`${picks.length} ${picks.length === 1 ? 'foto salva' : 'fotos salvas'} a partir do vídeo.`);
    const next = PhotoAngle.options.find((a) => !last.photos.some((p) => p.angle === a));
    setAngle(next ?? current);
  }

  async function finish() {
    try {
      const rec = await actions.complete.mutateAsync();
      navigate(`/reconstructions/${rec.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const showCapture = !pending && (!existing || retaking);

  return (
    <>
      <Link to={`/patients/${s.patientId}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden /> {patient.data?.name ?? 'Paciente'}
      </Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Captura facial</h1>
          <p className="mt-1 text-muted">{requiredSaved} de {REQUIRED_ANGLES.length} vistas obrigatórias{extrasSaved > 0 ? ` + ${extrasSaved} extra${extrasSaved > 1 ? 's' : ''}` : ''} · as imagens são processadas no próprio aparelho antes do envio.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setCancelling(true)}>Cancelar sessão</Button>
          <Button onClick={finish} disabled={!done} loading={actions.complete.isPending}>Concluir e gerar modelo 3D</Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="Vistas" className="flex flex-col gap-4">
          <ol className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-1">
            {PhotoAngle.options.map((a, i) => {
              const photo = byAngle.get(a);
              const active = a === current;
              return (
                <li key={a}>
                  <button
                    type="button"
                    aria-current={active ? 'step' : undefined}
                    onClick={() => {
                      setAngle(a);
                      setPending(null);
                      setRetaking(false);
                    }}
                    className={cn(
                      'flex w-full flex-col items-center gap-2 rounded-lg border p-2 text-left text-sm transition-colors lg:flex-row',
                      active ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-field',
                    )}
                  >
                    <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-subtle text-xs font-semibold text-muted">
                      {photo ? <img src={photo.url} alt="" className="size-full object-cover" /> : i + 1}
                      {photo && <CheckCircle2 className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full bg-white text-ok" aria-hidden />}
                    </span>
                    <span className="hidden min-w-0 lg:block">
                      <span className="block font-medium">{ANGLE_RULES[a].label}</span>
                      <span className="text-xs text-muted">
                        {photo ? (photo.validation === 'MANUAL' ? 'Salva · validação manual' : 'Salva') : REQUIRED_ANGLES.includes(a) ? 'Pendente' : 'Opcional'}
                      </span>
                    </span>
                    <span className="sr-only lg:hidden">{ANGLE_RULES[a].label}{photo ? ', salva' : ', pendente'}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <Card className="hidden p-4 lg:block">
            <p className="mb-2 text-sm font-medium">Antes de fotografar</p>
            <CaptureTips />
          </Card>
        </nav>

        <Card className="p-5">
          {pending ? (
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_17rem]">
              <img src={pending.previewUrl} alt={`Prévia: ${ANGLE_RULES[current].label}`} className="mx-auto aspect-[3/4] w-full max-w-md rounded-xl bg-subtle object-contain" />
              <div className="flex flex-col gap-3">
                <p className="font-medium">Revise a foto</p>
                <p className="text-sm text-muted">Confira foco, luz e enquadramento antes de salvar.</p>
                {pending.meta.validation === 'MANUAL' && <Badge tone="warn">Validação manual</Badge>}
                <Button onClick={confirmPending} loading={uploading}>Salvar foto</Button>
                <Button variant="secondary" icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => setPending(null)} disabled={uploading}>
                  Refazer
                </Button>
              </div>
            </div>
          ) : showCapture ? (
            <>
              <div role="tablist" aria-label="Origem da foto" className="mb-5 inline-flex gap-1 rounded-lg bg-subtle p-1">
                {([
                  ['camera', 'Câmera', <Camera key="c" className="size-4" aria-hidden />],
                  ['upload', 'Enviar arquivo', <ImageUp key="u" className="size-4" aria-hidden />],
                  ['video', 'Vídeo', <Film key="v" className="size-4" aria-hidden />],
                ] as const).map(([m, label, icon]) => (
                  <button
                    key={m}
                    role="tab"
                    type="button"
                    aria-selected={mode === m}
                    onClick={() => setMode(m)}
                    className={cn('inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium', mode === m ? 'bg-surface shadow-card' : 'text-muted hover:text-ink')}
                  >
                    {icon} {label}
                  </button>
                ))}
              </div>
              {mode === 'camera' ? (
                <CameraCapture angle={current} onCaptured={setPending} />
              ) : mode === 'video' ? (
                <VideoCapture missing={missing} onPicked={saveVideoPicks} />
              ) : (
                <UploadCapture key={current} angle={current} onCaptured={setPending} />
              )}
            </>
          ) : existing ? (
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_17rem]">
              <img src={existing.url} alt={`Foto salva: ${ANGLE_RULES[current].label}`} className="mx-auto aspect-[3/4] w-full max-w-md rounded-xl bg-subtle object-contain" />
              <div className="flex flex-col gap-3">
                <p className="font-medium">{ANGLE_RULES[current].label}</p>
                <dl className="space-y-1 text-sm text-muted">
                  <div>Validação: {existing.validation === 'AUTO' ? 'automática' : 'manual'}</div>
                  {existing.yawDeg !== null && <div>Ângulo medido: {Math.round(Math.abs(existing.yawDeg))}°</div>}
                  {existing.width && <div>{existing.width} × {existing.height} px</div>}
                </dl>
                <Button variant="secondary" icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => setRetaking(true)}>Refazer</Button>
                <Button
                  variant="ghost"
                  icon={<Trash2 className="size-4" aria-hidden />}
                  loading={actions.deletePhoto.isPending}
                  onClick={() => actions.deletePhoto.mutate(current, { onError: (e) => toast.error(errorMessage(e)) })}
                >
                  Descartar foto
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      </div>

      <ConfirmDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        title="Cancelar a sessão de captura?"
        confirmLabel="Cancelar e apagar fotos"
        loading={actions.cancel.isPending}
        description="As fotos já enviadas nesta sessão serão apagadas. Você pode iniciar outra sessão depois."
        onConfirm={async () => {
          try {
            await actions.cancel.mutateAsync();
            navigate(`/patients/${s.patientId}`);
          } catch (e) {
            toast.error(errorMessage(e));
            setCancelling(false);
          }
        }}
      />
    </>
  );
}
