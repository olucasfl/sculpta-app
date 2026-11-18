import { Camera, RotateCcw } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/format';
import { DEFAULT_APPEARANCE, EYE_COLORS, HAIR_SWATCHES, skinColor, type Appearance, type EyeColorId } from './appearance';

interface Props {
  value: Appearance;
  onChange: (a: Appearance) => void;
  /** Tira as cores da foto frontal do paciente (se houver foto com pontos do rosto). */
  onFromPhoto?: () => void;
  photoBusy?: boolean;
  photoAvailable?: boolean;
}

const range = 'h-2 w-full cursor-pointer accent-[var(--color-primary-600)]';

/** Aparência do rosto: pele, olhos, cabelo e sobrancelhas. É só visual e fica no navegador, por simulação. */
export function AppearancePanel({ value: a, onChange, onFromPhoto, photoBusy, photoAvailable }: Props) {
  const set = (patch: Partial<Appearance>) => onChange({ ...a, ...patch });
  return (
    <details className="mb-4 border-b border-line pb-4" open>
      <summary className="cursor-pointer select-none font-semibold">Aparência</summary>
      <div className="mt-3 flex flex-col gap-4">
        {onFromPhoto && (
          <div>
            <Button size="sm" variant="secondary" loading={photoBusy} disabled={!photoAvailable} onClick={onFromPhoto} icon={<Camera className="size-4" aria-hidden />}>
              Usar cores da foto
            </Button>
            <p className="mt-1 text-xs text-muted">
              {photoAvailable ? 'Tira pele, íris e cabelo da foto frontal. Confira e ajuste abaixo.' : 'Sem foto frontal com pontos do rosto nesta captura.'}
            </p>
          </div>
        )}

        <label className="flex flex-col gap-1 text-sm font-medium">
          <span className="flex items-center justify-between">
            Tom de pele
            <span aria-hidden className="size-4 rounded-full border border-line" style={{ background: skinColor(a) }} />
          </span>
          <input type="range" min={0} max={1} step={0.01} value={a.skinTone} onChange={(e) => set({ skinTone: Number(e.target.value), skinHex: null })} className={range} />
        </label>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">Olhos</legend>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(EYE_COLORS) as EyeColorId[]).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={a.eyeColor === id && !a.irisHex}
                title={EYE_COLORS[id].label}
                onClick={() => set({ eyeColor: id, irisHex: null })}
                className={cn('inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-2 text-xs', a.eyeColor === id && !a.irisHex ? 'border-accent bg-accent-soft' : 'border-line hover:bg-subtle')}
              >
                <span aria-hidden className="size-4 rounded-full border border-black/10" style={{ background: EYE_COLORS[id].hex }} />
                {EYE_COLORS[id].label}
              </button>
            ))}
          </div>
          {a.irisHex && <p className="mt-1 text-xs text-muted">Usando a cor da foto. Escolha uma cor acima para trocar.</p>}
        </fieldset>

        <fieldset>
          <legend className="mb-1 flex w-full items-center justify-between text-sm font-medium">
            Cabelo
            <label className="flex min-h-11 items-center gap-2 text-xs font-normal">
              <input type="checkbox" checked={a.hairVisible} onChange={(e) => set({ hairVisible: e.target.checked })} className="size-5 accent-[var(--color-primary-600)]" />
              Mostrar
            </label>
          </legend>
          {a.hairVisible && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {HAIR_SWATCHES.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Cor do cabelo ${hex}`}
                    aria-pressed={a.hairHex.toLowerCase() === hex}
                    onClick={() => set({ hairHex: hex })}
                    className={cn('size-8 rounded-full border-2', a.hairHex.toLowerCase() === hex ? 'border-accent' : 'border-line')}
                    style={{ background: hex }}
                  />
                ))}
                <input type="color" aria-label="Escolher outra cor de cabelo" value={a.hairHex} onChange={(e) => set({ hairHex: e.target.value })} className="size-8 cursor-pointer rounded-full border border-line bg-transparent p-0" />
              </div>
              <label className="flex flex-col gap-1 text-xs font-medium">
                Volume
                <input type="range" min={0} max={1} step={0.01} value={a.hairVolume} onChange={(e) => set({ hairVolume: Number(e.target.value) })} className={range} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium">
                Comprimento
                <input type="range" min={0} max={1} step={0.01} value={a.hairLength} onChange={(e) => set({ hairLength: Number(e.target.value) })} className={range} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium">
                Entradas (linha do cabelo)
                <input type="range" min={0} max={1} step={0.01} value={a.hairline} onChange={(e) => set({ hairline: Number(e.target.value) })} className={range} />
              </label>
              <p className="text-xs text-muted">É um molde aproximado do cabelo, não fio a fio.</p>
            </div>
          )}
        </fieldset>

        <label className="flex items-center justify-between gap-3 text-sm font-medium">
          Sobrancelhas
          <input type="color" aria-label="Cor das sobrancelhas" value={a.browHex} onChange={(e) => set({ browHex: e.target.value })} className="size-8 cursor-pointer rounded-full border border-line bg-transparent p-0" />
        </label>

        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={a.light} onChange={(e) => set({ light: e.target.checked })} className="size-5 accent-[var(--color-primary-600)]" />
          Modo leve (sem poros nem brilho de pele; para aparelhos fracos)
        </label>

        <Button size="sm" variant="ghost" onClick={() => onChange({ ...DEFAULT_APPEARANCE, light: a.light })} icon={<RotateCcw className="size-4" aria-hidden />}>
          Restaurar aparência
        </Button>
      </div>
    </details>
  );
}
