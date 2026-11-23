import { ChevronsDown, ChevronsUp, Eraser, Redo2, Trash2, Undo2, Waves } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/format';
import { MAX_OFFSET, STROKE_DEPTH, type BrushParams, type BrushTool } from './sculpt';
import type { SculptState } from './sculptRuntime';

export type BrushSettings = Omit<BrushParams, 'pressure'>;

export const DEFAULT_BRUSH: BrushSettings = { tool: 'add', radius: 0.012, strength: 0.3, symmetry: true };

const TOOLS: { id: BrushTool; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: 'add', label: 'Adicionar volume', hint: 'Como um preenchimento: a pele sobe, para fora', icon: <ChevronsUp className="size-4" aria-hidden /> },
  { id: 'reduce', label: 'Reduzir volume', hint: 'A pele afunda, para dentro', icon: <ChevronsDown className="size-4" aria-hidden /> },
  { id: 'smooth', label: 'Suavizar', hint: 'Alisa o que foi modelado', icon: <Waves className="size-4" aria-hidden /> },
  { id: 'erase', label: 'Apagar', hint: 'Desfaz o modelado pintando por cima', icon: <Eraser className="size-4" aria-hidden /> },
];

interface Props {
  brush: BrushSettings;
  onChange: (b: BrushSettings) => void;
  state: SculptState;
  /** Nome do procedimento escolhido: o pincel só age dentro da zona dele. */
  zoneLabel?: string | null;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}

/** Ferramentas do pincel de escultura. O traço vale na hora; cada traço pode ser desfeito. */
export function BrushPanel({ brush, onChange, state, zoneLabel, onUndo, onRedo, onClear }: Props) {
  return (
    <section aria-label="Pincel de escultura" className="mb-4 border-b border-line pb-4">
      <h2 className="font-semibold">Modelagem fina{zoneLabel ? ` · ${zoneLabel}` : ''}</h2>
      <p className="mb-3 text-xs text-muted">
        {zoneLabel
          ? 'O pincel só age dentro da área destacada do procedimento; fora dela o anel fica cinza e nada muda. A borracha vale em qualquer lugar. '
          : 'Arraste sobre o rosto com o mouse, a caneta ou o dedo. '}
        Fora do rosto, a câmera gira. Com caneta, a pressão muda a força.
      </p>

      <div role="group" aria-label="Ferramenta" className="grid grid-cols-2 gap-1.5">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={brush.tool === t.id}
            title={t.hint}
            onClick={() => onChange({ ...brush, tool: t.id })}
            className={cn(
              'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-2 text-sm font-medium',
              brush.tool === t.id ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-subtle hover:text-ink',
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          <span className="flex justify-between">
            Tamanho do pincel <span className="font-normal text-muted tabular-nums">{Math.round(brush.radius * 1000)} mm</span>
          </span>
          <input
            type="range"
            min={0.004}
            max={0.04}
            step={0.001}
            value={brush.radius}
            onChange={(e) => onChange({ ...brush, radius: Number(e.target.value) })}
            className="h-2 w-full cursor-pointer accent-[var(--color-primary-600)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          <span className="flex justify-between">
            Quanto por traço <span className="font-normal text-muted tabular-nums">{(brush.strength * STROKE_DEPTH * 1000).toFixed(1)} mm</span>
          </span>
          <input
            type="range"
            min={0.03}
            max={1}
            step={0.01}
            value={brush.strength}
            onChange={(e) => onChange({ ...brush, strength: Number(e.target.value) })}
            className="h-2 w-full cursor-pointer accent-[var(--color-primary-600)]"
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={brush.symmetry}
            onChange={(e) => onChange({ ...brush, symmetry: e.target.checked })}
            className="size-5 accent-[var(--color-primary-600)]"
          />
          Simetria (espelha no outro lado do rosto)
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={!state.canUndo} onClick={onUndo} icon={<Undo2 className="size-4" aria-hidden />}>
          Desfazer traço
        </Button>
        <Button size="sm" variant="secondary" disabled={!state.canRedo} onClick={onRedo} icon={<Redo2 className="size-4" aria-hidden />}>
          Refazer
        </Button>
        <Button size="sm" variant="ghost" disabled={!state.hasSculpt} onClick={onClear} icon={<Trash2 className="size-4" aria-hidden />}>
          Limpar escultura
        </Button>
      </div>
      <div className="mt-3" aria-label="Maior alteração">
        <div className="flex justify-between text-xs">
          <span className="text-muted">Maior alteração na pele</span>
          <span className={cn('font-medium tabular-nums', state.maxMm > MAX_OFFSET * 800 ? 'text-amber-700' : 'text-ink')}>
            {state.maxMm.toFixed(1)} de {(MAX_OFFSET * 1000).toFixed(0)} mm
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-subtle">
          <div
            className={cn('h-full rounded-full', state.maxMm > MAX_OFFSET * 800 ? 'bg-amber-500' : 'bg-primary-600')}
            style={{ width: `${Math.min(100, (state.maxMm / (MAX_OFFSET * 1000)) * 100)}%` }}
          />
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">
        Cada traço adiciona ou reduz no máximo o valor de “Quanto por traço”, por mais que você demore. Para mais, passe de novo. O que você modela é guardado junto da versão salva; “Antes” mostra o rosto sem a escultura.
      </p>
    </section>
  );
}
