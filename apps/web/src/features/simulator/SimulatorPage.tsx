import {
  can,
  PROCEDURE_PRESETS,
  SIMULATION_DISCLAIMER,
  SLIDERS,
  type FaceRegion,
  type SimulationVersion,
} from '@sim/contracts';
import {
  ChevronLeft,
  Columns2,
  Download,
  Eye,
  Grid3x3,
  Info,
  Layers,
  Redo2,
  RotateCcw,
  Save,
  SplitSquareHorizontal,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Link, useBlocker, useParams } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Badge, Card } from '../../components/ui/Card';
import { ConfirmDialog, Dialog } from '../../components/ui/Dialog';
import { TextAreaField, TextField } from '../../components/ui/Field';
import { ErrorState, Loading } from '../../components/ui/States';
import { toast } from '../../components/ui/Toaster';
import { errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth-store';
import { cn, formatDateTime } from '../../lib/format';
import { useReconstruction } from '../capture/queries';
import { buildExportImage, download, EXPORT_VIEWS, thumbnail } from './exportImage';
import { FaceViewer, type CompareMode, type ModelInfo, type ViewerHandle, type ViewName } from './FaceViewer';
import { apply, commit, emptyHistory, redo, regionHasChanges, resetRegion, setLive, undo, type History } from './history';
import { logExport, useSaveVersion, useSimulation } from './queries';
import { SliderControl } from './SliderControl';
import { SourceBadge } from './SourceBadge';

const TEMPLATE_URL = '/models/template-head.glb';
const REGION_PRESET: Record<FaceRegion, string> = {
  nose: 'nose',
  lips: 'lips',
  chin: 'chin',
  jaw: 'jaw',
  malar: 'malar',
  infraorbital: 'infraorbital',
  nasolabial: 'infraorbital',
};
const VIEWS: { id: ViewName; label: string }[] = [
  { id: 'RIGHT_90', label: 'Perfil dir.' },
  { id: 'RIGHT_45', label: '45° dir.' },
  { id: 'FRONT', label: 'Frente' },
  { id: 'LEFT_45', label: '45° esq.' },
  { id: 'LEFT_90', label: 'Perfil esq.' },
];
const COMPARE: { id: CompareMode; label: string; icon: React.ReactNode }[] = [
  { id: 'off', label: 'Simulação', icon: <Layers className="size-4" aria-hidden /> },
  { id: 'curtain', label: 'Cortina', icon: <SplitSquareHorizontal className="size-4" aria-hidden /> },
  { id: 'side', label: 'Lado a lado', icon: <Columns2 className="size-4" aria-hidden /> },
  { id: 'hold', label: 'Alternar', icon: <Eye className="size-4" aria-hidden /> },
];

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
  const [showRegions, setShowRegions] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [compare, setCompare] = useState<CompareMode>('off');
  const [curtain, setCurtain] = useState(0.5);
  const [showOriginal, setShowOriginal] = useState(false);
  const [view, setView] = useState<ViewName>('FRONT');
  const [viewNonce, setViewNonce] = useState(0);
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const loadedVersion = useRef(false);

  // Abre a versão mais recente, se houver.
  useEffect(() => {
    if (!sim.data || loadedVersion.current) return;
    loadedVersion.current = true;
    const latest = sim.data.versions[0];
    if (latest) {
      setHistory(emptyHistory(latest.params));
      setSavedParams(JSON.stringify(latest.params));
    }
  }, [sim.data]);

  const dirty = JSON.stringify(history.committed) !== savedParams;
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

  if (sim.isPending || (sim.data && rec.isPending)) return <Loading label="Carregando simulação…" />;
  if (sim.isError) return <ErrorState error={sim.error} onRetry={() => sim.refetch()} />;
  if (rec.isError) return <ErrorState error={rec.error} onRetry={() => rec.refetch()} />;
  const s = sim.data;
  const r = rec.data!;
  const preset = PROCEDURE_PRESETS.find((p) => p.id === presetId)!;
  const sliders = SLIDERS.filter((x) => (preset.sliders as readonly string[]).includes(x.id));
  const regionsInPreset = [...new Set(sliders.map((x) => x.region))];
  const canWrite = can(role, 'simulations.write');
  const modelUrl = r.meshUrl ?? TEMPLATE_URL;
  const isDemo = r.source === 'TEMPLATE' || info?.kind === 'TEMPLATE';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={`/patients/${s.patientId}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ChevronLeft className="size-4" aria-hidden /> {s.patientName}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{s.name}</h1>
            <SourceBadge source={r.source} qualityScore={r.qualityScore} />
            {dirty && <Badge>Alterações não salvas</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" aria-label="Desfazer" title="Desfazer" disabled={!history.past.length} onClick={() => setHistory(undo)}>
            <Undo2 className="size-4" aria-hidden />
          </Button>
          <Button variant="secondary" size="sm" aria-label="Refazer" title="Refazer" disabled={!history.future.length} onClick={() => setHistory(redo)}>
            <Redo2 className="size-4" aria-hidden />
          </Button>
          <Button variant="secondary" size="sm" icon={<RotateCcw className="size-4" aria-hidden />} disabled={!Object.keys(history.live).length} onClick={() => setHistory((h) => apply(h, {}))}>
            Restaurar tudo
          </Button>
          {canWrite && (
            <Button size="sm" icon={<Save className="size-4" aria-hidden />} onClick={() => setSaving(true)}>
              Salvar versão
            </Button>
          )}
          {can(role, 'simulations.export') && (
            <Button size="sm" variant="secondary" icon={<Download className="size-4" aria-hidden />} onClick={() => setExporting(true)}>
              Exportar
            </Button>
          )}
        </div>
      </div>

      <p className="flex items-start gap-2 rounded-lg border border-warn/20 bg-warn-soft px-3 py-2 text-xs text-warn">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          {SIMULATION_DISCLAIMER}
          {isDemo && ' Este é um modelo genérico de demonstração: não representa o rosto do paciente.'}
        </span>
      </p>

      <div className="grid gap-4 xl:grid-cols-[14rem_minmax(0,1fr)_19rem] lg:grid-cols-[minmax(0,1fr)_19rem]">
        <Card className="p-3 lg:col-span-2 xl:col-span-1">
          <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-faint">Procedimento</p>
          <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-1">
            {PROCEDURE_PRESETS.map((p) => {
              const changed = SLIDERS.some((x) => (p.sliders as readonly string[]).includes(x.id) && (history.live[x.id] ?? 0) !== 0);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-pressed={p.id === presetId}
                    onClick={() => {
                      setPresetId(p.id);
                      setHighlight(SLIDERS.find((x) => x.id === p.sliders[0])?.region ?? null);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium',
                      p.id === presetId ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-subtle hover:text-ink',
                    )}
                  >
                    {p.label}
                    {changed && <span className="size-2 rounded-full bg-accent" aria-label="com alterações" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 px-2 text-xs text-muted">Dica: clique numa região do rosto para abrir os controles dela.</p>
        </Card>

        <Card className="relative overflow-hidden">
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
              highlight={highlight}
              showRegions={showRegions}
              wireframe={wireframe}
              compare={compare}
              curtain={curtain}
              showOriginal={showOriginal}
              view={view}
              viewNonce={viewNonce}
              onRegionPick={onRegionPick}
              onLoaded={onLoaded}
            />
            {!info && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loading label="Carregando modelo 3D…" />
              </div>
            )}
          </ViewerArea>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2">
            <div role="group" aria-label="Vistas" className="flex flex-wrap gap-1">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={view === v.id}
                  onClick={() => goTo(v.id)}
                  className={cn('rounded-md px-2.5 py-1 text-xs font-medium', view === v.id ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-subtle hover:text-ink')}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <div role="group" aria-label="Comparação" className="flex gap-1 rounded-lg bg-subtle p-0.5">
                {COMPARE.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={compare === c.id}
                    title={c.label}
                    onClick={() => setCompare(c.id)}
                    className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium', compare === c.id ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}
                  >
                    {c.icon}
                    <span className="hidden sm:inline">{c.label}</span>
                  </button>
                ))}
              </div>
              <button type="button" aria-pressed={showRegions} onClick={() => setShowRegions((v) => !v)} title="Mostrar regiões" className={cn('rounded-md p-1.5', showRegions ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-subtle')}>
                <Layers className="size-4" aria-hidden />
                <span className="sr-only">Mostrar regiões</span>
              </button>
              <button type="button" aria-pressed={wireframe} onClick={() => setWireframe((v) => !v)} title="Malha (wireframe)" className={cn('rounded-md p-1.5', wireframe ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-subtle')}>
                <Grid3x3 className="size-4" aria-hidden />
                <span className="sr-only">Malha (wireframe)</span>
              </button>
              <button type="button" onClick={() => goTo('FRONT')} title="Recentralizar câmera" className="rounded-md p-1.5 text-muted hover:bg-subtle">
                <RotateCcw className="size-4" aria-hidden />
                <span className="sr-only">Recentralizar câmera</span>
              </button>
            </div>
          </div>
          {info && (
            <p className="border-t border-line px-3 py-1.5 text-[11px] text-faint">
              {info.kind === 'TEMPLATE' ? 'Template genérico' : 'Malha reconstruída'} · {info.vertices.toLocaleString('pt-BR')} vértices · {info.sliders.length} bases de deformação
            </p>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="font-semibold">{preset.label}</h2>
              {regionsInPreset.some((rg) => regionHasChanges(history.live, rg)) && (
                <Button size="sm" variant="ghost" onClick={() => setHistory((h) => regionsInPreset.reduce((acc, rg) => resetRegion(acc, rg), h))}>
                  Restaurar região
                </Button>
              )}
            </div>
            <p className="mb-4 text-sm text-muted">{preset.description}</p>
            <div className="flex flex-col gap-5">
              {sliders.map((x) => (
                <SliderControl
                  key={x.id}
                  label={x.label}
                  min={x.min}
                  value={history.live[x.id] ?? 0}
                  onChange={(v) => setHistory((h) => setLive(h, x.id, v))}
                  onCommit={() => setHistory(commit)}
                  onFocusRegion={() => setHighlight(x.region)}
                />
              ))}
            </div>
            <p className="mt-4 rounded-lg bg-subtle px-3 py-2 text-xs text-muted">
              <strong className="font-medium text-ink">Limitação:</strong> {preset.limitation} Os controles não têm unidade e não indicam
              produto, quantidade ou técnica.
            </p>
          </Card>

          <VersionsCard
            versions={s.versions}
            onLoad={(v) => {
              setHistory((h) => apply(h, v.params));
              toast.ok(`Versão “${v.name}” carregada.`);
            }}
          />
        </div>
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
            });
            setSavedParams(JSON.stringify(history.committed));
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
    <div ref={area} className="relative h-[min(68vh,620px)] min-h-[360px] bg-gradient-to-b from-[#f3f3ef] to-[#e6e7e2]" onPointerMove={move} onPointerUp={() => (dragging.current = false)}>
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
            <div className="absolute left-1/2 top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow" />
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
