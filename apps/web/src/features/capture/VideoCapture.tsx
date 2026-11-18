import { ANGLE_RULES, PhotoAngle } from '@sim/contracts';
import { Film, Loader2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { applyFlip, readFlag } from './captureFlags';
import { encodeJpeg } from './imageEncoding';
import type { PendingPhoto } from './types';
import { type FrameAnalysis } from './vision/analysis';
import { pickFrames, type VideoSample } from './vision/autoCapture';
import { analyzeResult, getLandmarker, measureSharpness } from './vision/faceLandmarker';

export interface VideoPick {
  angle: PhotoAngle;
  photo: PendingPhoto;
}

const MAX_SECONDS = 120;
const round = (n: number) => Math.round(n * 1e4) / 1e4;
type Analyzed = FrameAnalysis & { landmarks: { x: number; y: number; z: number }[] | null };

const seek = (v: HTMLVideoElement, t: number) =>
  new Promise<void>((resolve) => {
    const done = () => {
      v.removeEventListener('seeked', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 4000);
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });

/**
 * Vídeo no lugar de várias fotos: o profissional grava (ou envia) um vídeo girando o rosto devagar e o app
 * escolhe sozinho o melhor quadro de cada vista. Tudo roda no navegador; só as fotos escolhidas são enviadas.
 * O mesmo vídeo não é guardado.
 */
export function VideoCapture({ missing, onPicked }: { missing: PhotoAngle[]; onPicked: (picks: VideoPick[]) => Promise<void> }) {
  const inputId = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<VideoPick[] | null>(null);
  const [skipped, setSkipped] = useState<PhotoAngle[]>([]);
  const [chosen, setChosen] = useState<Set<PhotoAngle>>(new Set());
  const [saving, setSaving] = useState(false);
  const urls = useRef<string[]>([]);

  useEffect(
    () => () => {
      urls.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setPicks(null);
    const objectUrl = URL.createObjectURL(file);
    try {
      setBusy('Abrindo o vídeo…');
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.src = objectUrl;
      await new Promise<void>((resolve, reject) => {
        v.onloadeddata = () => resolve();
        v.onerror = () => reject(new Error('Não foi possível ler este vídeo. Use MP4 ou WebM.'));
      });
      if (!Number.isFinite(v.duration) || v.duration < 2) throw new Error('O vídeo é curto demais. Grave de 10 a 30 segundos girando o rosto devagar.');
      if (v.duration > MAX_SECONDS) throw new Error(`O vídeo passa de ${MAX_SECONDS} segundos. Use um trecho menor.`);

      let landmarker;
      try {
        landmarker = await getLandmarker('IMAGE');
      } catch {
        throw new Error('A detecção facial não carregou; sem ela não dá para escolher os quadros. Use fotos.');
      }
      const flip = readFlag('sculpta.flipSide', false);
      const count = Math.min(90, Math.max(12, Math.round(v.duration * 5)));
      const samples: VideoSample[] = [];
      for (let i = 0; i < count; i++) {
        const t = (v.duration * (i + 0.5)) / count;
        setBusy(`Analisando quadros… ${i + 1} de ${count}`);
        await seek(v, t);
        const sharp = measureSharpness(v, v.videoWidth, v.videoHeight);
        const raw = analyzeResult(landmarker.detect(v), sharp);
        samples.push({ t, analysis: { ...raw, ...applyFlip(raw, flip) } as Analyzed });
      }

      const wanted = PhotoAngle.options.filter((a) => missing.includes(a));
      const best = pickFrames(samples, wanted);
      const out: VideoPick[] = [];
      for (const [angle, sample] of best) {
        setBusy(`Preparando ${ANGLE_RULES[angle].label}…`);
        await seek(v, sample.t);
        const photo = await encodeJpeg(v, v.videoWidth, v.videoHeight);
        urls.current.push(photo.previewUrl);
        const a = sample.analysis as Analyzed;
        out.push({
          angle,
          photo: {
            ...photo,
            meta: {
              width: photo.width,
              height: photo.height,
              yawDeg: a.yawDeg,
              pitchDeg: a.pitchDeg ?? null,
              sharpness: a.sharpness,
              faceDetected: a.faceDetected,
              faceHeightRatio: a.faceHeightRatio,
              validation: 'AUTO',
              source: 'UPLOAD',
              landmarks: angle === 'FRONT' && a.landmarks ? a.landmarks.map((p) => [round(p.x), round(p.y), round(p.z)] as [number, number, number]) : undefined,
            },
          },
        });
      }
      setPicks(out);
      setChosen(new Set(out.map((p) => p.angle)));
      setSkipped(wanted.filter((a) => !best.has(a)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      URL.revokeObjectURL(objectUrl);
      setBusy(null);
    }
  }

  async function save() {
    if (!picks) return;
    setSaving(true);
    try {
      await onPicked(picks.filter((p) => chosen.has(p.angle)));
      setPicks(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-medium">Vídeo guiado</p>
        <p className="text-sm text-muted">
          Grave de 10 a 30 segundos: comece de frente, vire devagar para um lado até o perfil, volte, faça o outro lado e, por fim, levante e abaixe o queixo. O app escolhe o melhor quadro de cada vista.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={inputId} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-medium text-white ${busy ? 'pointer-events-none opacity-60' : ''}`}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Film className="size-4" aria-hidden />}
          Gravar ou escolher vídeo
        </label>
        <input id={inputId} type="file" accept="video/*" capture="user" className="sr-only" onChange={onFile} disabled={!!busy} />
        {busy && <p role="status" className="text-sm text-muted">{busy}</p>}
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      {picks && (
        <div className="flex flex-col gap-3">
          {picks.length === 0 ? (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">Nenhum quadro serviu para as vistas que faltam. Grave de novo com mais luz, ou use fotos.</p>
          ) : (
            <>
              <p className="text-sm font-medium">Quadros escolhidos ({chosen.size} de {picks.length}). Desmarque os que não gostar.</p>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {picks.map((p) => (
                  <li key={p.angle} className="flex flex-col gap-1">
                    <img src={p.photo.previewUrl} alt={`Quadro: ${ANGLE_RULES[p.angle].label}`} className="aspect-[3/4] w-full rounded-lg bg-subtle object-cover" />
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-5 accent-[var(--color-primary-600)]"
                        checked={chosen.has(p.angle)}
                        onChange={(e) =>
                          setChosen((c) => {
                            const n = new Set(c);
                            if (e.target.checked) n.add(p.angle);
                            else n.delete(p.angle);
                            return n;
                          })
                        }
                      />
                      {ANGLE_RULES[p.angle].short}
                    </label>
                  </li>
                ))}
              </ul>
              <Button onClick={save} loading={saving} disabled={chosen.size === 0}>
                Salvar {chosen.size} {chosen.size === 1 ? 'foto' : 'fotos'}
              </Button>
            </>
          )}
          {skipped.length > 0 && (
            <p className="text-sm text-muted">
              Sem quadro bom para: {skipped.map((a) => ANGLE_RULES[a].short).join(', ')}. Tire essas vistas por foto.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
