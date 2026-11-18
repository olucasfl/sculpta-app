import { ANGLE_RULES, type PhotoAngle } from '@sim/contracts';
import { ImageUp, Loader2 } from 'lucide-react';
import { useId, useState, type ChangeEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { CaptureChecks } from './CaptureChecks';
import { decodeFile, encodeJpeg } from './imageEncoding';
import type { PendingPhoto } from './types';
import { evaluate } from './vision/analysis';
import { analyzeResult, getLandmarker, measureSharpness } from './vision/faceLandmarker';

/** Alternativa à câmera: envio de arquivo, com a mesma validação (quando o modelo carrega). */
export function UploadCapture({ angle, onCaptured }: { angle: PhotoAngle; onCaptured: (p: PendingPhoto) => void }) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<{ photo: PendingPhoto; ready: boolean; checks: ReturnType<typeof evaluate>['checks']; modelOk: boolean } | null>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const bitmap = await decodeFile(file);
      const photo = await encodeJpeg(bitmap, bitmap.width, bitmap.height);
      const sharpness = measureSharpness(bitmap, bitmap.width, bitmap.height);
      let modelOk = true;
      let a = analyzeResult(null, sharpness);
      try {
        const lm = await getLandmarker('IMAGE');
        a = analyzeResult(lm.detect(bitmap), sharpness);
      } catch {
        modelOk = false;
      }
      bitmap.close();
      const ev = evaluate(angle, a);
      setCandidate({
        modelOk,
        ready: modelOk && ev.ready,
        checks: modelOk ? ev.checks : [],
        photo: {
          ...photo,
          meta: {
            width: photo.width,
            height: photo.height,
            yawDeg: a.yawDeg,
            sharpness: a.sharpness,
            faceDetected: a.faceDetected,
            faceHeightRatio: a.faceHeightRatio,
            validation: 'AUTO',
            source: 'UPLOAD',
            landmarks: angle === 'FRONT' && a.landmarks ? a.landmarks.map((p) => [p.x, p.y, p.z].map((n) => Math.round(n * 1e4) / 1e4) as [number, number, number]) : undefined,
          },
        },
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const use = (manual: boolean) => {
    if (!candidate) return;
    onCaptured({ ...candidate.photo, meta: { ...candidate.photo.meta, validation: manual ? 'MANUAL' : 'AUTO' } });
    setCandidate(null);
  };

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="mx-auto flex aspect-[3/4] w-full max-w-md items-center justify-center overflow-hidden rounded-xl border border-dashed border-field bg-subtle">
        {candidate ? (
          <img src={candidate.photo.previewUrl} alt={`Prévia: ${ANGLE_RULES[angle].label}`} className="size-full object-contain" />
        ) : (
          <label htmlFor={inputId} className="flex cursor-pointer flex-col items-center gap-2 p-6 text-center text-muted hover:text-ink">
            {busy ? <Loader2 className="size-6 animate-spin" aria-hidden /> : <ImageUp className="size-6" aria-hidden />}
            <span className="text-sm font-medium">{busy ? 'Analisando…' : 'Escolher arquivo'}</span>
            <span className="text-xs">JPEG, PNG ou WebP. Metadados (incluindo localização) são removidos.</span>
          </label>
        )}
        <input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onFile} disabled={busy} />
      </div>
      <div className="flex flex-col gap-4">
        <div>
          <p className="font-medium">{ANGLE_RULES[angle].label}</p>
          <p className="text-sm text-muted">{ANGLE_RULES[angle].instruction}</p>
        </div>
        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        {candidate && (
          <>
            {!candidate.modelOk && (
              <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">Detecção facial indisponível; a foto será marcada como validação manual.</p>
            )}
            <CaptureChecks checks={candidate.checks} />
            <div className="flex flex-col gap-2">
              {candidate.ready ? (
                <Button onClick={() => use(false)}>Usar esta foto</Button>
              ) : (
                <Button variant="secondary" onClick={() => use(true)}>Usar mesmo assim (validação manual)</Button>
              )}
              <label htmlFor={inputId} className="cursor-pointer text-center text-sm font-medium text-accent hover:underline">
                Escolher outro arquivo
              </label>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
