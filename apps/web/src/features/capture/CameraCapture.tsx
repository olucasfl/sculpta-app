import { ANGLE_RULES, type PhotoAngle } from '@sim/contracts';
import { FaceLandmarker, type FaceLandmarker as FL } from '@mediapipe/tasks-vision';
import { Camera, CameraOff, Loader2, ScanFace, SwitchCamera } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { AngleGuide, CaptureChecks } from './CaptureChecks';
import { encodeJpeg } from './imageEncoding';
import type { PendingPhoto } from './types';
import { evaluate, type FrameAnalysis } from './vision/analysis';
import { applyFlip, readFlag, writeFlag } from './captureFlags';
import { initialStability, poseOf, stepStability, type StabilityState } from './vision/autoCapture';
import { analyzeResult, getLandmarker, measureSharpness } from './vision/faceLandmarker';

type CameraState = 'idle' | 'starting' | 'live' | 'error';
type ModelState = 'loading' | 'ready' | 'unavailable';

const MANUAL_AFTER_MS = 10_000;

function cameraError(e: unknown): string {
  const name = (e as { name?: string }).name;
  if (!window.isSecureContext) return 'A câmera só funciona em HTTPS ou localhost.';
  if (name === 'NotAllowedError') return 'Permissão da câmera negada. Libere o acesso nas configurações do navegador ou use o envio de arquivo.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Nenhuma câmera encontrada neste aparelho. Use o envio de arquivo.';
  if (name === 'NotReadableError') return 'A câmera está em uso por outro aplicativo. Feche-o e tente de novo.';
  return 'Não foi possível abrir a câmera. Use o envio de arquivo.';
}

const defaultFacing = (): 'user' | 'environment' =>
  navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) >= 600 ? 'environment' : 'user';

/**
 * Câmera com guia e validação em tempo real. A permissão só é pedida quando o usuário
 * clica em "Abrir câmera". O vídeo nunca sai do navegador; só a foto escolhida é enviada.
 */
export function CameraCapture({ angle, onCaptured }: { angle: PhotoAngle; onCaptured: (p: PendingPhoto) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const landmarker = useRef<FL | null>(null);
  const latest = useRef<(FrameAnalysis & { landmarks: { x: number; y: number; z: number }[] | null }) | null>(null);
  const [state, setState] = useState<CameraState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<ModelState>('loading');
  const [facing, setFacing] = useState(defaultFacing);
  const [analysis, setAnalysis] = useState<FrameAnalysis | null>(null);
  const [showLandmarks, setShowLandmarks] = useState(true);
  const [since, setSince] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(() => readFlag('sculpta.autoCapture', true));
  const [flip, setFlip] = useState(() => readFlag('sculpta.flipSide', false));
  const [progress, setProgress] = useState(0);
  const [discarded, setDiscarded] = useState<string | null>(null);
  const angleRef = useRef(angle);
  const autoRef = useRef(auto);
  const flipRef = useRef(flip);
  const busyRef = useRef(false);
  const stability = useRef<StabilityState>(initialStability());
  const captureRef = useRef<(manual: boolean) => void>(() => {});
  angleRef.current = angle;
  autoRef.current = auto;
  flipRef.current = flip;

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  useEffect(() => () => stop(), [stop]);
  useEffect(() => {
    setSince(Date.now());
    setAnalysis(null);
    setDiscarded(null);
    stability.current = initialStability();
    setProgress(0);
  }, [angle]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function start(nextFacing = facing) {
    setError(null);
    setState('starting');
    stop();
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacing, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      });
      stream.current = s;
      const v = video.current!;
      v.srcObject = s;
      await v.play();
      setState('live');
      setSince(Date.now());
    } catch (e) {
      setError(cameraError(e));
      setState('error');
    }
    getLandmarker('VIDEO')
      .then((l) => {
        landmarker.current = l;
        setModel('ready');
      })
      .catch(() => setModel('unavailable'));
  }

  // Vigia da câmera: se o fluxo morrer ou congelar (tela preta), reabre sozinho, até 3 vezes seguidas.
  const startRef = useRef(start);
  startRef.current = start;
  const restarts = useRef(0);
  useEffect(() => {
    if (state !== 'live') return;
    let lastTime = -1;
    let lastChange = Date.now();
    const check = () => {
      const v = video.current;
      const s = stream.current;
      if (!v || !s || document.visibilityState !== 'visible') {
        lastChange = Date.now();
        return;
      }
      if (v.currentTime !== lastTime) {
        lastTime = v.currentTime;
        lastChange = Date.now();
        restarts.current = 0;
      }
      const track = s.getVideoTracks()[0];
      const dead = !track || track.readyState === 'ended';
      if (v.paused && !dead) void v.play().catch(() => {});
      if (!dead && Date.now() - lastChange <= 3000) return;
      lastChange = Date.now();
      if (restarts.current >= 3) {
        stop();
        setError('A câmera parou de responder. Toque em "Tentar de novo".');
        setState('error');
        return;
      }
      restarts.current += 1;
      void startRef.current();
    };
    const timer = setInterval(check, 1000);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [state, stop]);

  // Laço de detecção: ~10 análises/s, nitidez ~3/s.
  useEffect(() => {
    if (state !== 'live') return;
    let raf = 0;
    let lastDetect = 0;
    let lastSharp = 0;
    let sharp: number | null = null;
    const tick = () => {
      const v = video.current;
      const t = performance.now();
      if (v && v.readyState >= 2 && t - lastDetect > 100) {
        lastDetect = t;
        if (t - lastSharp > 300) {
          sharp = measureSharpness(v, v.videoWidth, v.videoHeight);
          lastSharp = t;
        }
        let result: ReturnType<FL['detectForVideo']> | null = null;
        try {
          result = landmarker.current ? landmarker.current.detectForVideo(v, t) : null;
        } catch {
          result = null; // um quadro ruim não pode derrubar o laço
        }
        const raw = analyzeResult(result, sharp);
        const a = { ...raw, ...applyFlip(raw, flipRef.current) };
        latest.current = a;
        setAnalysis(a);
        // Foto automática: pose válida por 1 s e quadro nítido.
        const ready = !!landmarker.current && evaluate(angleRef.current, a).ready;
        const step = stepStability(stability.current, t, autoRef.current && ready && !busyRef.current, a.sharpness, poseOf(a));
        stability.current = step.state;
        setProgress(step.progress);
        if (step.fire) {
          stability.current = initialStability();
          captureRef.current(false);
        }
        drawOverlay(overlay.current, v, a.landmarks, showLandmarks);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, showLandmarks]);

  const evaluation = analysis && model === 'ready' ? evaluate(angle, analysis) : null;
  const rule = ANGLE_RULES[angle];
  const allowManual = model === 'unavailable' || rule.profile || now - since > MANUAL_AFTER_MS;

  async function capture(manual: boolean) {
    const v = video.current;
    if (!v) return;
    setBusy(true);
    busyRef.current = true;
    try {
      // Congela o quadro agora; é ESTE quadro que é verificado e guardado, não o que vier depois.
      const snap = document.createElement('canvas');
      snap.width = v.videoWidth;
      snap.height = v.videoHeight;
      snap.getContext('2d')?.drawImage(v, 0, 0);
      let a = latest.current;
      if (!manual) {
        const verdict = await verifySnapshot(snap, angleRef.current, flipRef.current, a);
        if (!verdict.ok) {
          stability.current = initialStability();
          setProgress(0);
          setDiscarded(`Foto descartada: ${verdict.reason} Tente de novo.`);
          return;
        }
        a = verdict.analysis;
        setDiscarded(null);
      }
      const photo = await encodeJpeg(snap, snap.width, snap.height);
      onCaptured({
        ...photo,
        meta: {
          width: photo.width,
          height: photo.height,
          yawDeg: a?.yawDeg ?? null,
          pitchDeg: a?.pitchDeg ?? null,
          sharpness: a?.sharpness ?? null,
          faceDetected: a?.faceDetected ?? false,
          faceHeightRatio: a?.faceHeightRatio ?? null,
          validation: manual ? 'MANUAL' : 'AUTO',
          source: 'CAMERA',
          landmarks: angle === 'FRONT' && a?.landmarks ? a.landmarks.map((p) => [round(p.x), round(p.y), round(p.z)]) : undefined,
        },
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  captureRef.current = (manual) => void capture(manual);

  const mirrored = facing === 'user';

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="relative mx-auto aspect-[3/4] w-full max-w-md overflow-hidden rounded-xl bg-ink">
        <video ref={video} playsInline muted className={`size-full object-cover ${mirrored ? '-scale-x-100' : ''}`} />
        <canvas ref={overlay} className={`pointer-events-none absolute inset-0 size-full object-cover ${mirrored ? '-scale-x-100' : ''}`} />
        {state === 'live' && <AngleGuide angle={angle} ready={!!evaluation?.ready} progress={auto ? progress : 0} />}
        {state !== 'live' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
            {state === 'starting' ? (
              <Loader2 className="size-6 animate-spin" aria-label="Abrindo câmera" />
            ) : state === 'error' ? (
              <>
                <CameraOff className="size-6" aria-hidden />
                <p role="alert" className="text-sm">{error}</p>
                <Button variant="secondary" size="sm" onClick={() => start()}>Tentar de novo</Button>
              </>
            ) : (
              <>
                <Camera className="size-6" aria-hidden />
                <p className="text-sm text-white/80">A permissão da câmera é pedida só agora.</p>
                <Button onClick={() => start()}>Abrir câmera</Button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <p className="font-medium">{rule.label}</p>
          <p className="text-sm text-muted">{rule.instruction}</p>
        </div>

        {state === 'live' && (
          <>
            {model === 'loading' && (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Carregando detecção facial…
              </p>
            )}
            {model === 'unavailable' && (
              <p role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
                A detecção facial não carregou neste aparelho. As fotos ficam marcadas como validação manual.
              </p>
            )}
            {evaluation && <CaptureChecks checks={evaluation.checks} />}
            {discarded && (
              <p role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{discarded}</p>
            )}

            <div className="flex flex-col gap-2">
              <Button onClick={() => capture(false)} disabled={!evaluation?.ready} loading={busy} icon={<Camera className="size-4" aria-hidden />}>
                {evaluation?.ready ? (auto && progress > 0 ? 'Mantenha a pose…' : 'Capturar') : 'Aguardando posição'}
              </Button>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={auto}
                  onChange={(e) => {
                    setAuto(e.target.checked);
                    writeFlag('sculpta.autoCapture', e.target.checked);
                  }}
                  className="size-5 accent-[var(--color-primary-600)]"
                />
                Foto automática (após 1 s na pose certa)
              </label>
              {allowManual && (
                <Button variant="secondary" size="sm" onClick={() => capture(true)} disabled={busy}>
                  Capturar sem validação automática
                </Button>
              )}
              {allowManual && (
                <p className="text-xs text-muted">A foto fica marcada como “validação manual” no registro.</p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                icon={<SwitchCamera className="size-4" aria-hidden />}
                onClick={() => {
                  const next = facing === 'user' ? 'environment' : 'user';
                  setFacing(next);
                  void start(next);
                }}
              >
                Trocar câmera
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={flip}
                onClick={() => {
                  setFlip(!flip);
                  writeFlag('sculpta.flipSide', !flip);
                }}
              >
                {flip ? 'Lado invertido' : 'Inverter lado'}
              </Button>
              <Button variant="ghost" size="sm" icon={<ScanFace className="size-4" aria-hidden />} aria-pressed={showLandmarks} onClick={() => setShowLandmarks((v) => !v)}>
                {showLandmarks ? 'Ocultar pontos' : 'Mostrar pontos'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

type Verdict = { ok: true; analysis: FrameAnalysis & { landmarks: { x: number; y: number; z: number }[] | null } } | { ok: false; reason: string };

/**
 * Confere o quadro congelado (não o ao vivo) contra as regras da vista. Se o detector de imagem não carregar,
 * usa a última análise, que precisa estar válida. Quem se mexeu entre a contagem e o disparo é barrado aqui.
 */
async function verifySnapshot(
  snap: HTMLCanvasElement,
  angle: PhotoAngle,
  flip: boolean,
  fallback: (FrameAnalysis & { landmarks: { x: number; y: number; z: number }[] | null }) | null,
): Promise<Verdict> {
  let analysis = fallback;
  try {
    const lm = await getLandmarker('IMAGE');
    const raw = analyzeResult(lm.detect(snap), measureSharpness(snap, snap.width, snap.height));
    analysis = { ...raw, ...applyFlip(raw, flip) };
  } catch {
    /* sem detector de imagem: vale a última análise ao vivo */
  }
  if (!analysis) return { ok: false, reason: 'não foi possível medir o rosto.' };
  const result = evaluate(angle, analysis);
  if (result.ready) return { ok: true, analysis };
  const first = result.checks.find((c) => !c.ok);
  const reason = first ? `${(first.hint ?? first.label).replace(/\.$/, '')}.` : 'o rosto saiu da posição.';
  return { ok: false, reason: reason.charAt(0).toLowerCase() + reason.slice(1) };
}

function drawOverlay(
  canvas: HTMLCanvasElement | null,
  v: HTMLVideoElement,
  landmarks: { x: number; y: number }[] | null,
  show: boolean,
) {
  if (!canvas) return;
  if (canvas.width !== v.videoWidth) canvas.width = v.videoWidth;
  if (canvas.height !== v.videoHeight) canvas.height = v.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!show || !landmarks) return;
  ctx.fillStyle = 'rgba(94, 234, 212, 0.75)';
  for (const p of landmarks) ctx.fillRect(p.x * canvas.width - 1, p.y * canvas.height - 1, 2, 2);
  ctx.strokeStyle = 'rgba(94, 234, 212, 0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const c of FaceLandmarker.FACE_LANDMARKS_FACE_OVAL) {
    const a = landmarks[c.start];
    const b = landmarks[c.end];
    if (!a || !b) continue;
    ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
    ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
  }
  ctx.stroke();
}
