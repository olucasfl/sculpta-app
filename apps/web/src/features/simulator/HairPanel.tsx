import { cn } from '../../lib/format';
import { HAIR_SWATCHES, type Appearance } from './appearance';
import { describeDetection, HAIR_PRESETS, type DetectedHair } from './hairStyles';

interface Props {
  value: Appearance;
  onChange: (a: Appearance) => void;
  detected: DetectedHair | null | undefined;
  /** Cor lida da foto (hex), mostrada como padrão. */
  photoColor: string | null | undefined;
}

const range = 'h-2 w-full cursor-pointer accent-[var(--color-primary-600)]';

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'min-h-9 rounded-full border px-3 text-xs font-medium',
        active ? 'border-primary-600 bg-primary-600 text-white' : 'border-line bg-surface text-fg hover:bg-subtle',
      )}
    >
      {children}
    </button>
  );
}

/** Cabelo do modelo reconstruído: vem da foto por padrão; dá para trocar por um modelo pronto, mudar tamanho e cor. */
export function HairPanel({ value: a, onChange, detected, photoColor }: Props) {
  const set = (p: Partial<Appearance>) => onChange({ ...a, ...p });
  const shown = a.hairColorHex ?? photoColor ?? '#2a2018';
  return (
    <section aria-label="Cabelo" className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Cabelo</h3>
      <p className="rounded-lg bg-subtle px-3 py-2 text-xs text-muted">
        {a.hairModel === 'auto' ? describeDetection(detected) : 'Modelo escolhido por você. Volte ao automático para usar o cabelo da foto.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <Chip active={a.hairModel === 'auto'} onClick={() => set({ hairModel: 'auto' })}>
          Automático (da foto)
        </Chip>
        <Chip active={a.hairModel === 'none'} onClick={() => set({ hairModel: 'none' })}>
          Sem fios
        </Chip>
      </div>
      {(['m', 'f'] as const).map((g) => (
        <div key={g} className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">{g === 'm' ? 'Modelos masculinos' : 'Modelos femininos'}</span>
          <div className="flex flex-wrap gap-2">
            {HAIR_PRESETS.filter((p) => p.gender === g).map((p) => (
              <Chip key={p.id} active={a.hairModel === p.id} onClick={() => set({ hairModel: p.id })}>
                {p.label}
              </Chip>
            ))}
          </div>
        </div>
      ))}
      {a.hairModel !== 'none' && (
        <>
          <label className="flex flex-col gap-1 text-sm font-medium">
            <span className="flex justify-between">
              Tamanho <span className="text-muted">{Math.round(a.hairScale * 100)}%</span>
            </span>
            <input type="range" min={0.4} max={2} step={0.05} value={a.hairScale} onChange={(e) => set({ hairScale: Number(e.target.value) })} className={range} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Quantidade de fios
            <input type="range" min={0} max={1} step={0.01} value={a.hairVolume} onChange={(e) => set({ hairVolume: Number(e.target.value) })} className={range} />
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Cor</span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-pressed={a.hairColorHex === null}
                onClick={() => set({ hairColorHex: null })}
                className={cn('flex min-h-8 items-center gap-1 rounded-full border-2 px-2 text-xs', a.hairColorHex === null ? 'border-accent' : 'border-line')}
              >
                <span className="size-4 rounded-full border border-line" style={{ background: photoColor ?? '#2a2018' }} />
                Da foto
              </button>
              {HAIR_SWATCHES.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  aria-label={`Cor ${hex}`}
                  aria-pressed={a.hairColorHex?.toLowerCase() === hex}
                  onClick={() => set({ hairColorHex: hex })}
                  className={cn('size-8 rounded-full border-2', a.hairColorHex?.toLowerCase() === hex ? 'border-accent' : 'border-line')}
                  style={{ background: hex }}
                />
              ))}
              <input
                type="color"
                aria-label="Escolher outra cor de cabelo"
                value={shown}
                onChange={(e) => set({ hairColorHex: e.target.value })}
                className="size-8 cursor-pointer rounded-full border border-line bg-transparent p-0"
              />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
