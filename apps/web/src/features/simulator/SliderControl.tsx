import { useId } from 'react';

interface Props {
  label: string;
  value: number;
  min: number;
  onChange: (v: number) => void;
  onCommit: () => void;
  onFocusRegion?: () => void;
}

const describe = (v: number, min: number) => {
  if (v === 0) return 'sem alteração';
  const pct = Math.round(Math.abs(v) * 100);
  return min < 0 ? `${v > 0 ? '+' : '−'}${pct}%` : `${pct}%`;
};

/** Slider sem unidade (não é mm, dose ou volume). O histórico registra ao soltar. */
export function SliderControl({ label, value, min, onChange, onCommit, onFocusRegion }: Props) {
  const id = useId();
  const text = describe(value, min);
  return (
    <div className="flex flex-col gap-1.5" onMouseEnter={onFocusRegion}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <span className="flex items-center gap-1">
          <input
            type="number"
            inputMode="numeric"
            min={Math.round(min * 100)}
            max={100}
            step={1}
            value={Math.round(value * 100)}
            aria-label={`${label} em porcentagem`}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange(Math.min(1, Math.max(min, n / 100)));
            }}
            onBlur={onCommit}
            onKeyDown={(e) => e.key === 'Enter' && onCommit()}
            className="h-8 w-14 rounded-md border border-field bg-surface px-1.5 text-right text-xs tabular-nums"
          />
          <output htmlFor={id} className="sr-only">
            {text}
          </output>
          <span aria-hidden className="text-xs text-muted">%</span>
        </span>
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
      {min < 0 && (
        <div className="flex justify-between text-xs uppercase tracking-wide text-faint" aria-hidden>
          <span>menos</span>
          <span>mais</span>
        </div>
      )}
    </div>
  );
}
