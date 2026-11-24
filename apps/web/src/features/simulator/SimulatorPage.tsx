import {
  can,
  PROCEDURE_PRESETS,
  SLIDER_MAX_MM,
  SIMULATION_DISCLAIMER,
  SLIDERS,
  type FaceRegion,
  modelConfidence,
  type CaptureSession,
  type SculptData,
  type SimulationVersion,
  type SliderId,
} from '@sim/contracts';
import {
  ChevronLeft,
  Crosshair,
  Download,
  FileText,
  Grid3x3,
  History as HistoryIcon,
  Info,
  Layers,
  Maximize,
  MousePointerClick,
  Move3d,
  PanelRightClose,
  PanelRightOpen,
  PenTool,
  Redo2,
  RotateCcw,
  Save,
  SplitSquareHorizontal,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Link, useBlocker, useParams } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Badge, Card } from '../../components/ui/Card';
import { ConfirmDialog, Dialog } from '../../components/ui/Dialog';
import { TextAreaField, TextField } from '../../components/ui/Field';
import { ErrorState, Loading } from '../../components/ui/States';
import { toast } from '../../components/ui/Toaster';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth-store';
import { cn, formatDateTime } from '../../lib/format';
import { useReconstruction } from '../capture/queries';
import { fetchReport } from '../product/queries';
import { buildExportImage, download, EXPORT_VIEWS, thumbnail } from './exportImage';
import { brushTargets, PIXELS_PER_UNIT } from './brush';
import { FaceViewer, type CompareMode, type ModelInfo, type SculptHandlers, type ViewerHandle, type ViewName } from './FaceViewer';
import { apply, commit, emptyHistory, redo, regionHasChanges, resetRegion, setLive, undo, type History } from './history';
import { logExport, useSaveVersion, useSimulation } from './queries';
import { HairPanel } from './HairPanel';
import { AppearancePanel } from './AppearancePanel';
import { loadAppearance, saveAppearance, type Appearance } from './appearance';
import { BrushPanel, DEFAULT_BRUSH, type BrushSettings } from './BrushPanel';
import { colorsFromPhoto } from './photoColors';
import type { SculptState } from './sculptRuntime';
import { LowConfidenceScreen, NoWebglScreen } from './SimulatorStates';
import { ComparePanel, COMPARE_MODES, VIEW_LABELS, type CompareUi } from './ComparePanel';
import { ProcedurePanel } from './ProcedurePanel';
import { HEAT_MAX_MM } from './heat';
import { isBilateral, newPointId, type AppPoint } from './points';
import { SourceBadge } from './SourceBadge';

const GLASS = 'rounded-2xl border border-line bg-surface/85 shadow-pop backdrop-blur-md';
const TEMPLATE_URL ='/models/template-head.glb';
const REGION_PRESET: Record<FaceRegion, string> = {
  nose: 'nose',
  lips: 'lips',
  chin: 'chin',
  jaw: 'jaw',
  malar: 'malar',
  infraorbital: 'infraorbital',
  nasolabial: 'nasolabial',
  temple: 'temple',
  masseter: 'masseter',
};


export function SimulatorPage() {
  const { id = '' } = useParams();
  const role = useAuth((s) => s.user?.role ?? 'RECEPCAO');
  const sim = useSimulation(id);
  const rec = useReconstruction(sim.data?.reconstructionId ?? '');
  const save = useSaveVersion(id);
  const viewer = useRef<ViewerHandle>(null);

  const [history, setHistory] = useState<History>(emptyHistory);
  const [savedParams, setSavedParams] = useState<string>('{}');
  const [presetId, setPresetId] = useState(PROCEDURE_PRESETS[0]!.id);
  const [highlight, setHighlight] = useState<FaceRegion | null>(null);
  /** Zona em que a câmera deve se enquadrar (muda a cada escolha de procedimento). */
  const [focus, setFocus] = useState<{ regions: FaceRegion[]; nonce: number } | null>(null);
  const [showRegions, setShowRegions] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  /** Mapa de alterações (cor pelo quanto a pele saiu do lugar). */
  const [heatmap, setHeatmap] = useState(false);
  /** Pontos de aplicação (viram parte da modelagem ao salvar a versão). */
  const [points, setPoints] = useState<AppPoint[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [savedPoints, setSavedPoints] = useState('[]');
  const [compare, setCompare] = useState<CompareMode>('off');
  const [compareOpen, setCompareOpen] = useState(false);
  /** Painel da direita: um procedimento por vez (aba Procedimento) ou pele, olhos e cabelo (aba Aparência). */
  const [panelTab, setPanelTab] = useState<'procedure' | 'look'>('procedure');
  const [panelOpen, setPanelOpen] = useState(true);
  /** Telas estreitas (celular e tablet em pé): o painel fica embaixo e cobre a metade de baixo do rosto. */
  const [stacked, setStacked] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023.98px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023.98px)');
    const on = () => setStacked(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  /** Miniaturas das 5 vistas (a simulação como está agora); geradas só com o painel Comparar aberto. */
  const [thumbs, setThumbs] = useState<Partial<Record<ViewName, string>>>({});
  const [curtain, setCurtain] = useState(0.5);
  const [showOriginal, setShowOriginal] = useState(false);
  const [view, setView] = useState<ViewName>('FRONT');
  const [viewNonce, setViewNonce] = useState(0);
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  /** brush = pincel; regions = arrastar ajusta os sliders da região; rotate = só gira. */
  const [mode, setMode] = useState<'brush' | 'regions' | 'rotate'>('brush');
  const [brushSettings, setBrushSettings] = useState<BrushSettings>(DEFAULT_BRUSH);
  const [sculptState, setSculptState] = useState<SculptState>({ canUndo: false, canRedo: false, hasSculpt: false, revision: 0, maxMm: 0 });
  const [savedRevision, setSavedRevision] = useState(0);
  const [sculptData, setSculptData] = useState<SculptData | null>(null);
  const [sculptNonce, setSculptNonce] = useState(0);
  const [appearance, setAppearance] = useState<Appearance>(() => loadAppearance(id));
  const [photoBusy, setPhotoBusy] = useState(false);
  useEffect(() => saveAppearance(id, appearance), [id, appearance]);
  // A foto frontal (com os pontos do rosto) serve para tirar as cores. Só quem pode ver fotos a busca.
  const capture = useQuery({
    queryKey: ['captures', rec.data?.captureId ?? ''],
    queryFn: () => api<CaptureSession>(`/captures/${rec.data!.captureId}`),
    enabled: !!rec.data?.captureId && can(role, 'captures.read'),
  });
  const frontPhoto = capture.data?.photos.find((p) => p.angle === 'FRONT');

  const [reporting, setReporting] = useState(false);
  async function downloadReport() {
    setReporting(true);
    try {
      download(await fetchReport(id), 'relatorio-simulacao.pdf');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setReporting(false);
    }
  }

  async function colorsFromFrontPhoto() {
    if (!frontPhoto?.landmarks) return;
    setPhotoBusy(true);
    try {
      // URLs do armazenamento local passam pelo mesmo domínio do app; assim a leitura dos pixels não é bloqueada.
      const u = new URL(frontPhoto.url, window.location.href);
      const blob = await (await fetch(u.pathname.startsWith('/api/') ? u.pathname + u.search : frontPhoto.url)).blob();
      const bmp = await createImageBitmap(blob);
      const scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const found = colorsFromPhoto(ctx.getImageData(0, 0, canvas.width, canvas.height), frontPhoto.landmarks);
      setAppearance((a) => ({
        ...a,
        ...(found.skinHex ? { skinHex: found.skinHex } : {}),
        ...(found.irisHex ? { irisHex: found.irisHex } : {}),
        ...(found.hairHex ? { hairHex: found.hairHex, hairVisible: true } : {}),
      }));
      if (found.skinHex || found.irisHex || found.hairHex) toast.ok('Cores tiradas da foto. Confira e ajuste se precisar.');
      for (const n of found.notes) toast.error(n);
    } catch {
      toast.error('Não foi possível ler a foto. Escolha as cores à mão.');
    } finally {
      setPhotoBusy(false);
    }
  }
  const webgl = useMemo(() => {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
    } catch {
      return false;
    }
  }, []);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [hud, setHud] = useState<{ x: number; y: number; ids: SliderId[] } | null>(null);
  const loadedVersion = useRef(false);

  // Abre a versão mais recente, se houver.
  useEffect(() => {
    if (!sim.data || loadedVersion.current) return;
    loadedVersion.current = true;
    const latest = sim.data.versions[0];
    if (latest) {
      setHistory(emptyHistory(latest.params));
      setSavedParams(JSON.stringify(latest.params));
      setSculptData(latest.sculpt ?? null);
      setSculptNonce((n) => n + 1);
      setSavedRevision(0);
    }
  }, [sim.data]);

  const pointsKey = JSON.stringify(points.map((p) => [p.id, p.pos, p.mm, p.radius, p.mirror]));
  const dirty = JSON.stringify(history.committed) !== savedParams || sculptState.revision !== savedRevision || pointsKey !== savedPoints;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const goTo = (v: ViewName) => {
    setView(v);
    setViewNonce((n) => n + 1);
  };
  const onRegionPick = useCallback((r: FaceRegion) => {
    setHighlight(r);
    setPresetId(REGION_PRESET[r]);
  }, []);
  const onLoaded = useCallback((i: ModelInfo) => setInfo(i), []);

  // Miniaturas das 5 vistas, só com o painel Comparar aberto e depois de uma pausa nas mudanças
  useEffect(() => {
    if (!compareOpen || !info) return;
    const t = window.setTimeout(() => {
      const v = viewer.current;
      if (!v) return;
      const next: Partial<Record<ViewName, string>> = {};
      for (const { id } of VIEW_LABELS) next[id] = v.snapshot({ view: id, original: false, width: 120, height: 150 });
      setThumbs(next);
    }, 500);
    return () => window.clearTimeout(t);
  }, [compareOpen, info, history.live, sculptState.revision, points]);

  // regiões do procedimento escolhido (a zona onde os pontos valem)
  const presetRegions = useMemo(() => {
    const p = PROCEDURE_PRESETS.find((x) => x.id === presetId);
    return [...new Set(SLIDERS.filter((x) => (p?.sliders as readonly string[] | undefined)?.includes(x.id)).map((x) => x.region))];
  }, [presetId]);
  const placingRegions = useMemo(() => (placing ? presetRegions : null), [placing, presetRegions]);
  const onPlacePoint = useCallback(
    (pos: [number, number, number] | null) => {
      if (!pos) {
        toast.error('Toque dentro da área destacada do procedimento.');
        return;
      }
      const pt: AppPoint = { id: newPointId(), procedureId: presetId, regions: presetRegions, pos, mm: 1, radius: 10, mirror: isBilateral(presetRegions) };
      setPoints((cur) => [...cur, pt]);
      setSelectedPoint(pt.id);
      setPlacing(false);
    },
    [presetId, presetRegions],
  );
  const onMovePoint = useCallback((id: string, pos: [number, number, number]) => setPoints((cur) => cur.map((p) => (p.id === id ? { ...p, pos } : p))), []);

  // Modelagem direta: arrastar sobre o rosto move os sliders da região (ver brush.ts).
  const brush = useRef<{ v: SliderId; h?: SliderId } | null>(null);
  const sculptHandlers = useMemo<SculptHandlers>(
    () => ({
      start: (region, upper) => {
        brush.current = brushTargets(region, upper);
      },
      move: (dx, dy, pressure, x, y) => {
        const t = brush.current;
        if (!t) return;
        setHistory((h) => {
          let n = setLive(h, t.v, (h.live[t.v] ?? 0) - (dy / PIXELS_PER_UNIT) * pressure);
          if (t.h) n = setLive(n, t.h, (n.live[t.h] ?? 0) + (dx / PIXELS_PER_UNIT) * pressure);
          return n;
        });
        setHud({ x, y, ids: t.h ? [t.v, t.h] : [t.v] });
      },
      end: () => {
        brush.current = null;
        setHistory(commit);
        setHud(null);
      },
    }),
    [],
  );

  if (sim.isPending || (sim.data && rec.isPending)) return <Loading label="Carregando simulação…" />;
  if (sim.isError) return <ErrorState error={sim.error} onRetry={() => sim.refetch()} />;
  if (rec.isError) return <ErrorState error={rec.error} onRetry={() => rec.refetch()} />;
  const s = sim.data;
  const r = rec.data!;
  const confidence = modelConfidence(r.source, r.qualityScore);
  if (confidence === 'LOW') return <LowConfidenceScreen patientId={s.patientId} score={r.qualityScore} />;
  if (!webgl) return <NoWebglScreen patientId={s.patientId} />;
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };
  const preset = PROCEDURE_PRESETS.find((p) => p.id === presetId)!;
  /** Modo de comparação mostrado na interface: o mapa de alterações é o modo "Diferença". */
  const cmpMode: CompareUi = heatmap ? 'diff' : compare;
  const selectCompare = (m: CompareUi) => {
    setHeatmap(m === 'diff');
    setCompare(m === 'diff' ? 'off' : m);
    setShowOriginal(false);
  };
  const sliders = SLIDERS.filter((x) => (preset.sliders as readonly string[]).includes(x.id));
  const regionsInPreset = [...new Set(sliders.map((x) => x.region))];
  /** Limite de cada slider em mm: a medida deste rosto, ou a de um rosto médio. */
  const maxMmOf = (id: SliderId) => info?.sliderMm?.[id] ?? SLIDER_MAX_MM[id];
  /** O modelo tem os controles do procedimento (modelos antigos não têm os novos). */
  const isAvailable = (p: (typeof PROCEDURE_PRESETS)[number]) => !info || p.sliders.every((x) => info.sliders.includes(x));
  const canWrite = can(role, 'simulations.write');
  const modelUrl = r.meshUrl ?? TEMPLATE_URL;
  const isDemo = r.source === 'TEMPLATE' || info?.kind === 'TEMPLATE';

  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-[#e9eae5]">
      <ViewerArea
        compare={compare}
        curtain={curtain}
        setCurtain={setCurtain}
        showOriginal={showOriginal}
        setShowOriginal={setShowOriginal}
      >
        <FaceViewer
          ref={viewer}
          url={modelUrl}
          params={history.live}
          highlight={panelTab === 'look' ? null : (highlight ?? (mode === 'brush' ? (presetRegions[0] ?? null) : null))}
          showRegions={showRegions}
          wireframe={wireframe}
          compare={compare}
          curtain={curtain}
          showOriginal={showOriginal}
          view={view}
          viewNonce={viewNonce}
          focus={focus}
          focusLift={stacked ? 0.14 : 0}
          points={points}
          selectedPointId={selectedPoint}
          placing={placingRegions}
          heatmap={heatmap}
          brushZone={mode === 'brush' ? presetRegions : null}
          onPlacePoint={onPlacePoint}
          onMovePoint={onMovePoint}
          onSelectPoint={setSelectedPoint}
          onRegionPick={onRegionPick}
          onLoaded={onLoaded}
          sculpt={mode === 'regions' && canWrite ? sculptHandlers : undefined}
          brush={mode === 'brush' && canWrite ? brushSettings : undefined}
          sculptData={sculptData}
          sculptNonce={sculptNonce}
          onSculptChange={setSculptState}
          appearance={appearance}
        />
        {!info && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loading label="Carregando modelo 3D…" />
          </div>
        )}
      </ViewerArea>

      {heatmap && (
        <div className={cn(GLASS, 'pointer-events-none absolute bottom-28 left-1/2 z-20 w-64 -translate-x-1/2 px-3 py-2 text-xs')} aria-label="Legenda do mapa de alterações">
          <div className="mb-1 font-medium">Quanto a pele saiu do lugar</div>
          <div className="h-2 rounded-full" style={{ background: 'linear-gradient(90deg,#dcdbd7 0%,#8fb8ff 8%,#3ecf8e 40%,#ffd240 70%,#ff4d4d 100%)' }} />
          <div className="mt-1 flex justify-between text-muted tabular-nums">
            <span>0 mm</span>
            <span>{HEAT_MAX_MM / 2} mm</span>
            <span>{HEAT_MAX_MM} mm</span>
          </div>
        </div>
      )}

      {/* Barra superior */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between gap-2 p-3">
        <div className={cn(GLASS, 'pointer-events-auto px-3 py-2')}>
          <Link to={`/patients/${s.patientId}`} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
            <ChevronLeft className="size-3.5" aria-hidden /> {s.patientName}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-sm font-semibold tracking-tight">{s.name}</h1>
            <SourceBadge source={r.source} qualityScore={r.qualityScore} />
            {confidence === 'MEDIUM' && <Badge tone="warn">Confiança média</Badge>}
            {dirty && <Badge>Não salvo</Badge>}
          </div>
        </div>
        <div className={cn(GLASS, 'pointer-events-auto flex flex-wrap items-center gap-1.5 p-1.5')}>
          <Button variant="secondary" size="sm" aria-label="Desfazer" title="Desfazer" disabled={!history.past.length} onClick={() => setHistory(undo)}>
            <Undo2 className="size-4" aria-hidden />
          </Button>
          <Button variant="secondary" size="sm" aria-label="Refazer" title="Refazer" disabled={!history.future.length} onClick={() => setHistory(redo)}>
            <Redo2 className="size-4" aria-hidden />
          </Button>
          <Button variant="secondary" size="sm" icon={<RotateCcw className="size-4" aria-hidden />} disabled={!Object.keys(history.live).length && !sculptState.hasSculpt && points.length === 0} onClick={() => {
            setHistory((h) => apply(h, {}));
            viewer.current?.clearSculpt();
            setPoints([]);
            setSelectedPoint(null);
            setPlacing(false);
          }}>
            <span className="max-lg:sr-only">Restaurar tudo</span>
          </Button>
          <Button variant="secondary" size="sm" icon={<HistoryIcon className="size-4" aria-hidden />} onClick={() => setVersionsOpen((v) => !v)} aria-pressed={versionsOpen}>
            <span className="max-lg:sr-only">Versões</span>
          </Button>
          {canWrite && (
            <Button size="sm" icon={<Save className="size-4" aria-hidden />} onClick={() => setSaving(true)}>
              <span className="max-lg:sr-only">Salvar</span>
            </Button>
          )}
          {can(role, 'simulations.export') && (
            <Button size="sm" variant="secondary" icon={<Download className="size-4" aria-hidden />} onClick={() => setExporting(true)}>
              <span className="max-lg:sr-only">Exportar</span>
            </Button>
          )}
          {can(role, 'reports.generate') && (
            <Button size="sm" variant="secondary" icon={<FileText className="size-4" aria-hidden />} loading={reporting} onClick={downloadReport}>
              <span className="max-lg:sr-only">Relatório PDF</span>
            </Button>
          )}
        </div>
      </div>

      {/* Procedimentos: faixa à esquerda, junto do rosto */}
      <ul className={cn(GLASS, 'absolute left-3 top-24 z-20 flex flex-col gap-1 p-1.5 lg:top-[8.5rem] xl:top-24 max-lg:inset-x-3 max-lg:top-[10.25rem] max-lg:flex-row max-lg:overflow-x-auto')}>
        {PROCEDURE_PRESETS.map((p) => {
          const changed = SLIDERS.some((x) => (p.sliders as readonly string[]).includes(x.id) && (history.live[x.id] ?? 0) !== 0);
          return (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={p.id === presetId}
                onClick={() => {
                  setPresetId(p.id);
                  const regions = [...new Set(SLIDERS.filter((x) => (p.sliders as readonly string[]).includes(x.id)).map((x) => x.region))];
                  setHighlight(regions[0] ?? null);
                  setFocus((f) => ({ regions, nonce: (f?.nonce ?? 0) + 1 })); // destaca a zona e enquadra a câmera nela
                }}
                className={cn(
                  'flex min-h-11 w-full items-center justify-between gap-3 whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-sm font-medium',
                  p.id === presetId ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-subtle hover:text-ink',
                  !isAvailable(p) && 'opacity-50',
                )}
              >
                {p.label}
                {changed && <span className="size-2 rounded-full bg-primary-600" aria-label="com alterações" />}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Painel da direita: abas Procedimento e Aparência; pode ser recolhido para ver o rosto inteiro */}
      {!panelOpen && (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          aria-label="Mostrar o painel"
          className={cn(GLASS, 'absolute right-3 top-24 z-20 inline-flex min-h-11 items-center gap-1.5 px-3 text-sm font-medium lg:top-[8.5rem] xl:top-24 max-lg:bottom-[8.25rem] max-sm:bottom-[14rem] max-lg:top-auto')}
        >
          <PanelRightOpen className="size-4" aria-hidden /> Painel
        </button>
      )}
      {panelOpen && (
        <div className={cn(GLASS, 'absolute right-3 top-24 z-20 max-h-[calc(100%-14.5rem)] w-72 overflow-y-auto p-4 lg:top-[8.5rem] xl:top-24 xl:max-h-[calc(100%-10.5rem)] max-lg:inset-x-3 max-lg:bottom-[8.25rem] max-sm:bottom-[14rem] max-lg:top-auto max-lg:max-h-[34%] max-lg:w-auto')}>
          <div className="mb-3 flex items-center gap-1">
            <div role="tablist" aria-label="Painel" className="flex flex-1 gap-1 rounded-lg bg-subtle p-0.5">
              {(
                [
                  ['procedure', 'Procedimento'],
                  ['look', 'Aparência'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={panelTab === id}
                  onClick={() => setPanelTab(id)}
                  className={cn('min-h-10 flex-1 rounded-md px-2 text-sm font-medium', panelTab === id ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setPanelOpen(false)} title="Recolher o painel" className="grid size-10 place-items-center rounded-md text-muted hover:bg-subtle">
              <PanelRightClose className="size-4" aria-hidden />
              <span className="sr-only">Recolher o painel</span>
            </button>
          </div>

          {panelTab === 'procedure' ? (
            <div role="tabpanel" aria-label="Procedimento">
              <ProcedurePanel
                preset={preset}
                values={history.live}
                maxMm={maxMmOf}
                available={isAvailable(preset)}
                hasChanges={regionsInPreset.some((rg) => regionHasChanges(history.live, rg)) || points.some((p) => p.procedureId === preset.id)}
                disabled={!canWrite}
                onChange={(id, v) => setHistory((h) => setLive(h, id, v))}
                onCommit={() => setHistory(commit)}
                onApplyShape={(vals) => setHistory((h) => commit(sliders.reduce((acc, x) => setLive(acc, x.id, vals[x.id] ?? 0), h)))}
                onReset={() => {
                  setHistory((h) => regionsInPreset.reduce((acc, rg) => resetRegion(acc, rg), h));
                  setPoints((cur) => cur.filter((p) => p.procedureId !== preset.id));
                }}
                onFocusRegion={setHighlight}
                points={points.filter((p) => p.procedureId === preset.id)}
                selectedPointId={selectedPoint}
                placing={placing}
                onTogglePlacing={() => setPlacing((v) => !v)}
                onSelectPoint={setSelectedPoint}
                onUpdatePoint={(id, patch) => setPoints((cur) => cur.map((p) => (p.id === id ? { ...p, ...patch } : p)))}
                onRemovePoint={(id) => {
                  setPoints((cur) => cur.filter((p) => p.id !== id));
                  setSelectedPoint((cur) => (cur === id ? null : cur));
                }}
              />
              {mode === 'brush' && canWrite && (
                <div className="mt-4 border-t border-line pt-4">
                  <BrushPanel
                    brush={brushSettings}
                    onChange={setBrushSettings}
                    state={sculptState}
                    zoneLabel={preset.label}
                    onUndo={() => viewer.current?.undoSculpt()}
                    onRedo={() => viewer.current?.redoSculpt()}
                    onClear={() => viewer.current?.clearSculpt()}
                  />
                </div>
              )}
            </div>
          ) : (
            <div role="tabpanel" aria-label="Aparência">
              {info?.textured ? (
                <div className="flex flex-col gap-3">
                  <p className="rounded-lg bg-subtle px-3 py-2 text-xs text-muted">
                    Pele e olhos vêm das fotos deste paciente. O ajuste de aparência vale só para o modelo demonstrativo.
                  </p>
                  <HairPanel value={appearance} onChange={setAppearance} detected={info.hairStyle} photoColor={info.hairColor} />
                </div>
              ) : (
                <AppearancePanel value={appearance} onChange={setAppearance} onFromPhoto={canWrite ? colorsFromFrontPhoto : undefined} photoBusy={photoBusy} photoAvailable={!!frontPhoto?.landmarks} />
              )}
            </div>
          )}
        </div>
      )}

      {versionsOpen && (
        <div className="absolute right-3 top-16 z-30 w-80 max-lg:inset-x-3 max-lg:w-auto">
          <VersionsCard
            versions={s.versions}
            onLoad={(v) => {
              setHistory((h) => apply(h, v.params));
              setSculptData(v.sculpt ?? null);
              setSculptNonce((n) => n + 1);
              setSavedRevision(-1);
              setPoints([]); // os pontos da versão já estão dentro da modelagem salva
              setSelectedPoint(null);
              setSavedPoints('[]');
              toast.ok(`Versão “${v.name}” carregada.`);
            }}
          />
        </div>
      )}

      {/* Valor ao vivo junto da ponta da caneta/cursor */}
      {hud && (
        <div className="pointer-events-none fixed z-30 rounded-lg bg-ink/85 px-2.5 py-1.5 text-xs text-white shadow-pop" style={{ left: hud.x + 18, top: hud.y + 18 }}>
          {hud.ids.map((sid) => {
            const def = SLIDERS.find((x) => x.id === sid)!;
            const v = history.live[sid] ?? 0;
            const sign = def.min < 0 ? (v > 0 ? '+' : v < 0 ? '−' : '') : '';
            return (
              <div key={sid} className="flex justify-between gap-4 tabular-nums">
                <span>{def.label}</span>
                <span>{`${sign}${Math.round(Math.abs(v) * 100)}%`}</span>
              </div>
            );
          })}
        </div>
      )}

      {compareOpen && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[8.25rem] z-30 flex justify-center px-3 max-lg:bottom-[8.25rem] max-sm:bottom-[14rem]">
          <ComparePanel
            mode={cmpMode}
            onMode={selectCompare}
            view={view}
            onView={goTo}
            thumbs={thumbs}
            zoneLabel={preset.label}
            onZoomZone={() => setFocus((f) => ({ regions: presetRegions, nonce: (f?.nonce ?? 0) + 1 }))}
            onZoomAll={() => goTo(view)}
            onClose={() => setCompareOpen(false)}
          />
        </div>
      )}

      {/* Barra inferior: modo e ferramentas; a comparação e as vistas ficam no painel Comparar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-1.5 p-3">
        <div className={cn(GLASS, 'pointer-events-auto flex flex-wrap items-center justify-center gap-2 px-2 py-1.5')}>
          <div role="group" aria-label="Modo" className="flex gap-1 rounded-lg bg-subtle p-0.5">
            <button type="button" aria-pressed={mode === 'brush'} disabled={!canWrite} onClick={() => setMode('brush')} title="Pincel: modele a superfície com o mouse, a caneta ou o dedo" className={cn('inline-flex min-h-11 items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40', mode === 'brush' ? 'bg-primary-600 text-white shadow-card' : 'text-muted hover:text-ink')}>
              <PenTool className="size-4" aria-hidden /> Pincel
            </button>
            <button type="button" aria-pressed={mode === 'regions'} disabled={!canWrite} onClick={() => setMode('regions')} title="Regiões: arrastar sobre uma região move os controles dela" className={cn('inline-flex min-h-11 items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40', mode === 'regions' ? 'bg-primary-600 text-white shadow-card' : 'text-muted hover:text-ink')}>
              <MousePointerClick className="size-4" aria-hidden /> Regiões
            </button>
            <button type="button" aria-pressed={mode === 'rotate'} onClick={() => setMode('rotate')} className={cn('inline-flex min-h-11 items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium', mode === 'rotate' ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}>
              <Move3d className="size-4" aria-hidden /> Girar
            </button>
          </div>
          <button
            type="button"
            aria-expanded={compareOpen}
            onClick={() => setCompareOpen((v) => !v)}
            title="Comparar com o original, trocar de vista e dar zoom na zona"
            className={cn('inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium', compareOpen || cmpMode !== 'off' ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-subtle hover:text-ink')}
          >
            <SplitSquareHorizontal className="size-4" aria-hidden />
            Comparar
            {cmpMode !== 'off' && <span className="font-normal">· {COMPARE_MODES.find((m) => m.id === cmpMode)?.label}</span>}
          </button>
          <button type="button" aria-pressed={showRegions} onClick={() => setShowRegions((v) => !v)} title="Mostrar regiões" className={cn('grid size-11 place-items-center rounded-md', showRegions ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-subtle')}>
            <Layers className="size-4" aria-hidden />
            <span className="sr-only">Mostrar regiões</span>
          </button>
          <button type="button" aria-pressed={wireframe} onClick={() => setWireframe((v) => !v)} title="Malha (wireframe)" className={cn('grid size-11 place-items-center rounded-md', wireframe ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-subtle')}>
            <Grid3x3 className="size-4" aria-hidden />
            <span className="sr-only">Malha (wireframe)</span>
          </button>
          <button type="button" onClick={() => goTo('FRONT')} title="Recentralizar câmera" className="grid size-11 place-items-center rounded-md text-muted hover:bg-subtle">
            <Crosshair className="size-4" aria-hidden />
            <span className="sr-only">Recentralizar câmera</span>
          </button>
          {document.fullscreenEnabled && (
            <button type="button" onClick={toggleFullscreen} title="Tela cheia" className="grid size-11 place-items-center rounded-md text-muted hover:bg-subtle">
              <Maximize className="size-4" aria-hidden />
              <span className="sr-only">Tela cheia</span>
            </button>
          )}
        </div>
        <p className="pointer-events-none flex max-w-3xl items-start gap-1.5 px-2 text-center text-xs text-muted">
          <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>
            {SIMULATION_DISCLAIMER}
            {isDemo && ' Modelo genérico de demonstração: não representa o rosto do paciente.'}
            {info && ` · ${info.vertices.toLocaleString('pt-BR')} vértices`}
          </span>
        </p>
      </div>

      <SaveVersionDialog
        open={saving}
        defaultName={`Versão ${s.versions.length + 1}`}
        loading={save.isPending}
        onClose={() => setSaving(false)}
        onSave={async (name, description) => {
          try {
            await save.mutateAsync({
              name,
              description,
              params: history.committed,
              thumbnailDataUrl: viewer.current ? thumbnail(viewer.current) : undefined,
              sculpt: viewer.current?.getSculpt() ?? undefined,
            });
            setSavedParams(JSON.stringify(history.committed));
            setSavedRevision(sculptState.revision);
            setSavedPoints(pointsKey);
            setSaving(false);
            toast.ok('Versão salva.');
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />

      <ExportDialog
        open={exporting}
        onClose={() => setExporting(false)}
        onExport={async (views) => {
          if (!viewer.current) return;
          try {
            const blob = await buildExportImage(viewer.current, {
              views: EXPORT_VIEWS.filter((v) => views.includes(v.id)),
              title: `Simulação ilustrativa · ${s.versions[0]?.name ?? s.name}`,
              demo: isDemo,
            });
            await logExport(id, { views, versionId: s.versions[0]?.id });
            download(blob, `simulacao-${new Date().toISOString().slice(0, 10)}.png`);
            setExporting(false);
            toast.ok('Imagem exportada.');
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Sair sem salvar?"
        description="As alterações desde a última versão salva serão perdidas."
        confirmLabel="Sair sem salvar"
        onConfirm={() => blocker.proceed?.()}
        onClose={() => blocker.reset?.()}
      />
    </div>
  );
}

function ViewerArea({
  children,
  compare,
  curtain,
  setCurtain,
  showOriginal,
  setShowOriginal,
}: {
  children: React.ReactNode;
  compare: CompareMode;
  curtain: number;
  setCurtain: (v: number) => void;
  showOriginal: boolean;
  setShowOriginal: (v: boolean) => void;
}) {
  const area = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const move = (e: PointerEvent) => {
    if (!dragging.current || !area.current) return;
    const r = area.current.getBoundingClientRect();
    setCurtain(Math.min(0.95, Math.max(0.05, (e.clientX - r.left) / r.width)));
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') setCurtain(Math.max(0.05, curtain - 0.05));
    if (e.key === 'ArrowRight') setCurtain(Math.min(0.95, curtain + 0.05));
  };

  return (
    <div ref={area} className="absolute inset-0 bg-gradient-to-b from-[#f3f3ef] to-[#e6e7e2]" onPointerMove={move} onPointerUp={() => (dragging.current = false)}>
      {children}
      {compare === 'curtain' && (
        <>
          <Tag className="left-3">Original</Tag>
          <Tag className="right-3">Simulação</Tag>
          <div
            role="slider"
            tabIndex={0}
            aria-label="Divisão antes/depois"
            aria-valuemin={5}
            aria-valuemax={95}
            aria-valuenow={Math.round(curtain * 100)}
            onKeyDown={key}
            onPointerDown={(e) => {
              dragging.current = true;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            }}
            className="absolute inset-y-0 z-10 w-6 -translate-x-1/2 cursor-ew-resize touch-none"
            style={{ left: `${curtain * 100}%` }}
          >
            <div className="mx-auto h-full w-0.5 bg-white shadow" />
            <div className="absolute left-1/2 top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary-600 shadow" />
          </div>
        </>
      )}
      {compare === 'side' && (
        <>
          <Tag className="left-3">Original</Tag>
          <Tag className="left-[calc(50%+0.75rem)]">Simulação</Tag>
        </>
      )}
      {compare === 'hold' && (
        <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2">
          <button
            type="button"
            onPointerDown={() => setShowOriginal(true)}
            onPointerUp={() => setShowOriginal(false)}
            onPointerLeave={() => setShowOriginal(false)}
            onKeyDown={(e) => e.key === ' ' && setShowOriginal(true)}
            onKeyUp={(e) => e.key === ' ' && setShowOriginal(false)}
            aria-pressed={showOriginal}
            className="select-none rounded-full bg-ink/80 px-4 py-2 text-sm font-medium text-white shadow-pop"
          >
            {showOriginal ? 'Mostrando o original' : 'Segure para ver o original'}
          </button>
        </div>
      )}
    </div>
  );
}

const Tag = ({ className, children }: { className: string; children: React.ReactNode }) => (
  <span className={cn('pointer-events-none absolute top-3 z-10 rounded-full bg-ink/70 px-2.5 py-1 text-xs font-medium text-white', className)}>
    {children}
  </span>
);

function VersionsCard({ versions, onLoad }: { versions: SimulationVersion[]; onLoad: (v: SimulationVersion) => void }) {
  return (
    <Card className="p-4">
      <h2 className="mb-3 font-semibold">Versões salvas</h2>
      {versions.length === 0 ? (
        <p className="text-sm text-muted">Nenhuma versão ainda. Ajuste os controles e use “Salvar versão”.</p>
      ) : (
        <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {versions.map((v) => (
            <li key={v.id} className="flex items-center gap-3 rounded-lg border border-line p-2">
              <div className="size-12 shrink-0 overflow-hidden rounded-md bg-subtle">
                {v.thumbnailUrl && <img src={v.thumbnailUrl} alt="" className="size-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{v.name}</p>
                <p className="truncate text-xs text-muted">
                  {formatDateTime(v.createdAt)} · {v.createdBy.name}
                </p>
                {v.description && <p className="truncate text-xs text-faint">{v.description}</p>}
              </div>
              <Button size="sm" variant="ghost" onClick={() => onLoad(v)}>
                Carregar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SaveVersionDialog({
  open,
  defaultName,
  loading,
  onClose,
  onSave,
}: {
  open: boolean;
  defaultName: string;
  loading: boolean;
  onClose: () => void;
  onSave: (name: string, description?: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState('');
  useEffect(() => {
    if (open) {
      setName(defaultName);
      setDescription('');
    }
  }, [open, defaultName]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Salvar versão"
      description="Guarda os ajustes atuais no histórico do paciente."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={loading} disabled={!name.trim()} onClick={() => onSave(name.trim(), description.trim() || undefined)}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <TextAreaField label="Descrição" optional value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
      </div>
    </Dialog>
  );
}

function ExportDialog({ open, onClose, onExport }: { open: boolean; onClose: () => void; onExport: (views: ('FRONT' | 'THREE_QUARTER' | 'PROFILE')[]) => Promise<void> }) {
  const [views, setViews] = useState<('FRONT' | 'THREE_QUARTER' | 'PROFILE')[]>(['FRONT', 'THREE_QUARTER', 'PROFILE']);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Exportar antes/depois"
      description="Gera uma imagem PNG com marca d’água “simulação ilustrativa”, sem nome ou dados do paciente."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            loading={busy}
            disabled={views.length === 0}
            onClick={async () => {
              setBusy(true);
              await onExport(views);
              setBusy(false);
            }}
          >
            Exportar PNG
          </Button>
        </>
      }
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Vistas</legend>
        {EXPORT_VIEWS.map((v) => (
          <label key={v.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-accent)]"
              checked={views.includes(v.id)}
              onChange={() => setViews((cur) => (cur.includes(v.id) ? cur.filter((x) => x !== v.id) : [...cur, v.id]))}
            />
            {v.label}
          </label>
        ))}
      </fieldset>
    </Dialog>
  );
}
