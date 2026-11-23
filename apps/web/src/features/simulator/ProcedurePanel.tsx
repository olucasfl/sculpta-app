import type { ProcedurePreset, SliderId } from '@sim/contracts';
import { SLIDERS } from '@sim/contracts';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/format';
import { isBilateral, POINT_MM_MAX, POINT_RADIUS_MM, type AppPoint } from './points';
import { isShapeActive, shapeMm, SHAPES } from './procedureShapes';
import { SliderControl } from './SliderControl';

interface Props {
  preset: ProcedurePreset;
  values: Partial<Record<SliderId, number>>;
  /** Limite de cada slider em mm (valor 1 do slider). */
  maxMm: (id: SliderId) => number;
  /** O modelo tem os controles deste procedimento (modelos antigos não têm os novos). */
  available: boolean;
  hasChanges: boolean;
  disabled?: boolean;
  onChange: (id: SliderId, v: number) => void;
  onCommit: () => void;
  onApplyShape: (values: Partial<Record<SliderId, number>>) => void;
  onReset: () => void;
  onFocusRegion: (region: (typeof SLIDERS)[number]['region']) => void;
  /** Pontos de aplicação deste procedimento. */
  points: AppPoint[];
  selectedPointId: string | null;
  placing: boolean;
  onTogglePlacing: () => void;
  onSelectPoint: (id: string) => void;
  onUpdatePoint: (id: string, patch: Partial<AppPoint>) => void;
  onRemovePoint: (id: string) => void;
}

const fmt = (mm: number) => mm.toFixed(1).replace('.', ',');

/**
 * Painel de UM procedimento: formatos prontos (com o deslocamento aproximado em mm), um controle por ajuste, cada um
 * em mm com o limite da simulação, e aviso quando se chega perto dele.
 */
export function ProcedurePanel({
  preset,
  values,
  maxMm,
  available,
  hasChanges,
  disabled,
  onChange,
  onCommit,
  onApplyShape,
  onReset,
  onFocusRegion,
  points,
  selectedPointId,
  placing,
  onTogglePlacing,
  onSelectPoint,
  onUpdatePoint,
  onRemovePoint,
}: Props) {
  const sliders = SLIDERS.filter((x) => (preset.sliders as readonly string[]).includes(x.id));
  const ids = sliders.map((s) => s.id as SliderId);
  const shapes = SHAPES[preset.id] ?? [];
  const biggest = Math.max(0, ...sliders.map((s) => Math.abs(values[s.id as SliderId] ?? 0) * maxMm(s.id as SliderId)));

  return (
    <section aria-label={`Procedimento: ${preset.label}`}>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold">{preset.label}</h2>
        {hasChanges && (
          <Button size="sm" variant="ghost" onClick={onReset}>
            Restaurar
          </Button>
        )}
      </div>
      <p className="mb-3 text-xs text-muted">{preset.description}</p>

      {!available ? (
        <p className="rounded-lg bg-subtle px-3 py-2 text-xs text-muted">
          Este modelo foi reconstruído antes deste procedimento existir. Refaça a reconstrução da captura para habilitá-lo.
        </p>
      ) : (
        <>
          {shapes.length > 0 && (
            <div className="mb-4">
              <div className="mb-1.5 text-xs font-medium text-muted">Formatos prontos</div>
              <div className="flex flex-wrap gap-1.5">
                {shapes.map((sh) => {
                  const on = isShapeActive(sh, ids, values);
                  return (
                    <button
                      key={sh.id}
                      type="button"
                      disabled={disabled}
                      aria-pressed={on}
                      onClick={() => onApplyShape(sh.values)}
                      className={cn(
                        'min-h-11 rounded-lg border px-3 py-1 text-left text-sm font-medium disabled:opacity-40',
                        on ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-ink hover:bg-subtle',
                      )}
                    >
                      {sh.label}
                      <span className="block text-xs font-normal text-muted">até {fmt(shapeMm(sh, maxMm))} mm</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-4">
            {sliders.map((x) => (
              <SliderControl
                key={x.id}
                label={x.label}
                min={x.min}
                maxMm={maxMm(x.id as SliderId)}
                value={values[x.id as SliderId] ?? 0}
                onChange={(v) => onChange(x.id as SliderId, v)}
                onCommit={onCommit}
                onFocusRegion={() => onFocusRegion(x.region)}
              />
            ))}
          </div>
          <div className="mt-4 border-t border-line pt-3" aria-label="Pontos de aplicação">
            <div className="mb-1 text-sm font-medium">Pontos de aplicação</div>
            <p className="mb-2 text-xs text-muted">
              Marque onde aplicar. Cada ponto sobe a pele só dentro da área destacada, com a quantidade e o alcance que você escolher.
            </p>
            <Button size="sm" variant={placing ? 'primary' : 'secondary'} disabled={disabled} onClick={onTogglePlacing}>
              {placing ? 'Toque na área destacada (cancelar)' : 'Adicionar ponto'}
            </Button>
            {points.length > 0 && (
              <ul className="mt-3 flex flex-col gap-2">
                {points.map((p, i) => {
                  const on = p.id === selectedPointId;
                  return (
                    <li key={p.id} className={cn('rounded-lg border p-2', on ? 'border-accent bg-accent-soft/40' : 'border-line')}>
                      <button type="button" onClick={() => onSelectPoint(p.id)} aria-pressed={on} className="flex w-full items-center justify-between text-left text-sm font-medium">
                        Ponto {i + 1}
                        <span className="text-xs font-normal text-muted tabular-nums">
                          {fmt(p.mm)} mm · alcance {p.radius} mm
                        </span>
                      </button>
                      {on && (
                        <div className="mt-2 flex flex-col gap-2">
                          <label className="flex flex-col gap-1 text-xs font-medium">
                            <span className="flex justify-between">
                              Quantidade <span className="font-normal tabular-nums text-muted">{fmt(p.mm)} mm</span>
                            </span>
                            <input
                              type="range"
                              min={0.1}
                              max={POINT_MM_MAX}
                              step={0.1}
                              value={p.mm}
                              disabled={disabled}
                              onChange={(e) => onUpdatePoint(p.id, { mm: Number(e.target.value) })}
                              className="h-2 w-full cursor-pointer accent-[var(--color-accent)]"
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-xs font-medium">
                            <span className="flex justify-between">
                              Alcance <span className="font-normal tabular-nums text-muted">{p.radius} mm</span>
                            </span>
                            <input
                              type="range"
                              min={POINT_RADIUS_MM.min}
                              max={POINT_RADIUS_MM.max}
                              step={1}
                              value={p.radius}
                              disabled={disabled}
                              onChange={(e) => onUpdatePoint(p.id, { radius: Number(e.target.value) })}
                              className="h-2 w-full cursor-pointer accent-[var(--color-accent)]"
                            />
                          </label>
                          {isBilateral(p.regions) && (
                            <label className="flex items-center gap-2 text-xs">
                              <input type="checkbox" checked={p.mirror} disabled={disabled} onChange={(e) => onUpdatePoint(p.id, { mirror: e.target.checked })} className="size-4 accent-[var(--color-primary-600)]" />
                              Espelhar no outro lado
                            </label>
                          )}
                          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onRemovePoint(p.id)}>
                            Remover ponto
                          </Button>
                          <p className="text-xs text-muted">Arraste a bolinha sobre o rosto para mover o ponto.</p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <p className="mt-3 text-xs text-muted">
            Maior alteração neste procedimento: <span className="font-medium text-ink tabular-nums">{fmt(biggest)} mm</span>. O limite de cada controle é o fim da
            barra.
          </p>
        </>
      )}

      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer font-medium text-ink">Limitação</summary>
        <p className="mt-1">
          {preset.limitation} Os milímetros são do modelo e aproximados: a simulação não indica produto, quantidade ou técnica, e mudanças de 1 a 2 mm ficam perto da
          precisão do modelo.
        </p>
      </details>
    </section>
  );
}
