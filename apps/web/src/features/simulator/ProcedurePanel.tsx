import type { ProcedurePreset, SliderId } from '@sim/contracts';
import { SLIDERS } from '@sim/contracts';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/format';
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
}

const fmt = (mm: number) => mm.toFixed(1).replace('.', ',');

/**
 * Painel de UM procedimento: formatos prontos (com o deslocamento aproximado em mm), um controle por ajuste, cada um
 * em mm com o limite da simulação, e aviso quando se chega perto dele.
 */
export function ProcedurePanel({ preset, values, maxMm, available, hasChanges, disabled, onChange, onCommit, onApplyShape, onReset, onFocusRegion }: Props) {
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
