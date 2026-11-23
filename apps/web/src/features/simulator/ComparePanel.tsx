import { Columns2, Eye, Layers, SplitSquareHorizontal, Thermometer, X } from 'lucide-react';
import { cn } from '../../lib/format';
import type { ViewName } from './FaceViewer';

/** Como o resultado é comparado com o original. `diff` é o mapa de alterações (cor pelo quanto a pele mudou). */
export type CompareUi = 'off' | 'curtain' | 'hold' | 'side' | 'diff';

export const COMPARE_MODES: { id: CompareUi; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: 'off', label: 'Simulação', hint: 'Só o resultado da simulação.', icon: <Layers className="size-4" aria-hidden /> },
  { id: 'curtain', label: 'Cortina', hint: 'Arraste a linha para ver o original de um lado e a simulação do outro.', icon: <SplitSquareHorizontal className="size-4" aria-hidden /> },
  { id: 'hold', label: 'Alternar', hint: 'Segure o botão para ver o original e solte para voltar à simulação.', icon: <Eye className="size-4" aria-hidden /> },
  { id: 'side', label: 'Lado a lado', hint: 'Original e simulação juntos, na mesma vista.', icon: <Columns2 className="size-4" aria-hidden /> },
  { id: 'diff', label: 'Diferença', hint: 'Cores mostram quanto cada ponto da pele mudou, de 0 a 8 mm.', icon: <Thermometer className="size-4" aria-hidden /> },
];

export const VIEW_LABELS: { id: ViewName; label: string }[] = [
  { id: 'RIGHT_90', label: 'Perfil dir.' },
  { id: 'RIGHT_45', label: '45° dir.' },
  { id: 'FRONT', label: 'Frente' },
  { id: 'LEFT_45', label: '45° esq.' },
  { id: 'LEFT_90', label: 'Perfil esq.' },
];

interface Props {
  mode: CompareUi;
  onMode: (m: CompareUi) => void;
  view: ViewName;
  onView: (v: ViewName) => void;
  /** Miniaturas (PNG) da simulação em cada vista; faltando uma, mostra só o nome. */
  thumbs: Partial<Record<ViewName, string>>;
  /** Procedimento escolhido: o zoom enquadra a zona dele. */
  zoneLabel: string;
  onZoomZone: () => void;
  onZoomAll: () => void;
  onClose: () => void;
}

/**
 * Um lugar só para comparar: o modo (simulação, cortina, alternar, lado a lado, diferença), as 5 vistas em miniatura
 * (a escolhida vale para todos os modos) e o zoom na zona do procedimento.
 */
export function ComparePanel({ mode, onMode, view, onView, thumbs, zoneLabel, onZoomZone, onZoomAll, onClose }: Props) {
  const active = COMPARE_MODES.find((m) => m.id === mode)!;
  return (
    <section aria-label="Comparar" className="pointer-events-auto w-[min(34rem,calc(100vw-1.5rem))] rounded-2xl border border-line bg-surface/95 p-3 shadow-pop backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Comparar</h2>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-subtle" aria-label="Fechar comparação">
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div role="group" aria-label="Modo de comparação" className="grid grid-cols-5 gap-1 rounded-lg bg-subtle p-0.5 max-sm:grid-cols-3">
        {COMPARE_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={mode === m.id}
            onClick={() => onMode(m.id)}
            className={cn(
              'flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-xs font-medium',
              mode === m.id ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
            )}
          >
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted">{active.hint}</p>

      <div role="group" aria-label="Vistas" className="mt-3 grid grid-cols-5 gap-1.5">
        {VIEW_LABELS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={view === v.id}
            onClick={() => onView(v.id)}
            className={cn(
              'flex flex-col items-center gap-1 rounded-lg border p-1 text-xs font-medium',
              view === v.id ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-muted hover:bg-subtle hover:text-ink',
            )}
          >
            <span className="flex h-16 w-full items-center justify-center overflow-hidden rounded-md bg-subtle">
              {thumbs[v.id] ? <img src={thumbs[v.id]} alt="" className="size-full object-cover" /> : <span className="text-[10px] text-faint">…</span>}
            </span>
            {v.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onZoomZone} className="min-h-9 rounded-lg border border-line px-3 text-xs font-medium hover:bg-subtle">
          Zoom na zona: {zoneLabel}
        </button>
        <button type="button" onClick={onZoomAll} className="min-h-9 rounded-lg border border-line px-3 text-xs font-medium hover:bg-subtle">
          Rosto todo
        </button>
      </div>
    </section>
  );
}
