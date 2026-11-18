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
        <output htmlFor={id} className="text-xs tabular-nums text-muted">
          {text}
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
      {min < 0 && (
        <div className="flex justify-between text-xs uppercase tracking-wide text-faint" aria-hidden>
          <span>menos</span>
          <span>mais</span>
        </div>
      )}
    </div>
  );
}
