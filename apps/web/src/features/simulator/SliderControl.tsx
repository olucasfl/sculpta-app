import { useId } from 'react';

interface Props {
  label: string;
  value: number;
  min: number;
  /** Deslocamento máximo (mm) quando o valor é 1: o controle mostra o valor em mm e o limite. */
  maxMm?: number;
  onChange: (v: number) => void;
  onCommit: () => void;
  onFocusRegion?: () => void;
}

const NEAR_LIMIT = 0.85;

const mmText = (mm: number, signed: boolean) => {
  const t = Math.abs(mm).toFixed(1).replace('.', ',');
  if (mm === 0) return 'sem alteração';
  return `${signed ? (mm > 0 ? '+' : '−') : ''}${t} mm`;
};

const describe = (v: number, min: number, maxMm?: number) => {
  if (v === 0) return 'sem alteração';
  const pct = Math.round(Math.abs(v) * 100);
  const base = min < 0 ? `${v > 0 ? '+' : '−'}${pct}%` : `${pct}%`;
  return maxMm ? `${mmText(v * maxMm, min < 0)}, ${pct}% do limite` : base;
};

/**
 * Controle de um ajuste. Com `maxMm` mostra o valor em milímetros e o limite da simulação (o fim da barra) e avisa
 * quando se chega perto dele. O histórico registra ao soltar.
 */
export function SliderControl({ label, value, min, maxMm, onChange, onCommit, onFocusRegion }: Props) {
  const id = useId();
  const text = describe(value, min, maxMm);
  const near = Math.abs(value) >= NEAR_LIMIT;
  return (
    <div className="flex flex-col gap-1.5" onMouseEnter={onFocusRegion}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <output htmlFor={id} className={near ? 'text-sm font-semibold tabular-nums text-amber-700' : 'text-sm tabular-nums text-ink'}>
          {maxMm ? mmText(value * maxMm, min < 0) : `${Math.round(Math.abs(value) * 100)}%`}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={1}
        step={0.01}
        value={value}
        aria-valuetext={text}
        onFocus={onFocusRegion}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
        className="h-2 w-full cursor-pointer accent-[var(--color-accent)]"
      />
      <div className="flex justify-between text-xs text-faint" aria-hidden>
        <span>{min < 0 ? (maxMm ? `−${maxMm.toFixed(1).replace('.', ',')} mm` : 'menos') : '0'}</span>
        {near && <span className="font-medium text-amber-700">perto do limite</span>}
        <span>{maxMm ? `${maxMm.toFixed(1).replace('.', ',')} mm (limite)` : 'mais'}</span>
      </div>
    </div>
  );
}
