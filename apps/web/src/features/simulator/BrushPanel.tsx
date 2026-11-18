import { ChevronsDown, ChevronsUp, Eraser, Redo2, Trash2, Undo2, Waves } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/format';
import type { BrushParams, BrushTool } from './sculpt';
import type { SculptState } from './sculptRuntime';

export type BrushSettings = Omit<BrushParams, 'pressure'>;

export const DEFAULT_BRUSH: BrushSettings = { tool: 'push', radius: 0.024, strength: 0.6, symmetry: true };

const TOOLS: { id: BrushTool; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: 'push', label: 'Empurrar', hint: 'Sobe a superfície (volume)', icon: <ChevronsUp className="size-4" aria-hidden /> },
  { id: 'pull', label: 'Puxar', hint: 'Afunda a superfície', icon: <ChevronsDown className="size-4" aria-hidden /> },
  { id: 'smooth', label: 'Suavizar', hint: 'Alisa o que foi modelado', icon: <Waves className="size-4" aria-hidden /> },
  { id: 'erase', label: 'Apagar', hint: 'Desfaz o modelado pintando por cima', icon: <Eraser className="size-4" aria-hidden /> },
];

interface Props {
  brush: BrushSettings;
  onChange: (b: BrushSettings) => void;
  state: SculptState;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}

/** Ferramentas do pincel de escultura. O traço vale na hora; cada traço pode ser desfeito. */
export function BrushPanel({ brush, onChange, state, onUndo, onRedo, onClear }: Props) {
  return (
    <section aria-label="Pincel de escultura" className="mb-4 border-b border-line pb-4">
      <h2 className="font-semibold">Pincel</h2>
      <p className="mb-3 text-xs text-muted">Arraste sobre o rosto com o mouse, a caneta ou o dedo. Fora do rosto, a câmera gira. Com caneta, a pressão muda a força.</p>

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
            Tamanho <span className="font-normal text-muted tabular-nums">{Math.round(brush.radius * 1000)}</span>
          </span>
          <input
            type="range"
            min={0.008}
            max={0.06}
            step={0.001}
            value={brush.radius}
            onChange={(e) => onChange({ ...brush, radius: Number(e.target.value) })}
            className="h-2 w-full cursor-pointer accent-[var(--color-primary-600)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          <span className="flex justify-between">
            Força <span className="font-normal text-muted tabular-nums">{Math.round(brush.strength * 100)}%</span>
          </span>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
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
      <p className="mt-3 text-xs text-muted">O que você modela com o pincel é guardado junto da versão salva. “Antes” mostra o rosto sem a escultura.</p>
    </section>
  );
}
