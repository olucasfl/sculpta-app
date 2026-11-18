import { Check, Eye, EyeOff } from 'lucide-react';
import { useId, useState, type InputHTMLAttributes } from 'react';
import { PASSWORD_MIN } from '@sim/contracts';
import { cn } from '../../lib/format';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> {
  label: string;
  error?: string;
  hint?: string;
  /** Mostra o medidor de força (para campos de senha nova). */
  meter?: boolean;
}

const control =
  'h-11 w-full rounded-lg border bg-surface pl-3 pr-12 text-base text-ink placeholder:text-faint transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-subtle';

/** Avaliação simples e honesta: só tamanho e variedade de caracteres (não é uma garantia de segurança). */
export function passwordStrength(value: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!value) return { score: 0, label: '' };
  let points = 0;
  if (value.length >= PASSWORD_MIN) points++;
  if (value.length >= 14) points++;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) points++;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) points++;
  if (value.length < PASSWORD_MIN) return { score: 1, label: 'Curta demais' };
  const score = Math.max(1, Math.min(4, points)) as 1 | 2 | 3 | 4;
  return { score, label: (['', 'Fraca', 'Razoável', 'Boa', 'Forte'] as const)[score] };
}

const BAR = ['bg-line', 'bg-danger', 'bg-warn', 'bg-info', 'bg-ok'] as const;

/** Campo de senha com botão de mostrar/ocultar e, opcionalmente, medidor de força. */
export function PasswordField({ label, error, hint, meter, value, ...rest }: Props) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const text = String(value ?? '');
  const strength = meter ? passwordStrength(text) : null;
  const describedBy = [hint && !error && `${id}-hint`, error && `${id}-error`, meter && text && `${id}-meter`].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          {...rest}
          id={id}
          value={value}
          type={shown ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(control, error ? 'border-danger' : 'border-field')}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? 'Ocultar senha' : 'Mostrar senha'}
          aria-pressed={shown}
          className="absolute right-1 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink"
        >
          {shown ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
        </button>
      </div>
      {meter && text && strength && (
        <div id={`${id}-meter`} aria-live="polite" className="flex items-center gap-3">
          <div className="flex flex-1 gap-1" aria-hidden>
            {[1, 2, 3, 4].map((i) => (
              <span key={i} className={cn('h-1.5 flex-1 rounded-full', i <= strength.score ? BAR[strength.score] : 'bg-line')} />
            ))}
          </div>
          <span className="min-w-20 text-right text-xs font-medium text-muted">{strength.label}</span>
        </div>
      )}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Confirmação visual de que as duas senhas coincidem (só aparece depois que a pessoa começa a digitar a segunda). */
export function MatchHint({ a, b }: { a: string; b: string }) {
  if (!b) return null;
  const ok = a === b;
  return (
    <p aria-live="polite" className={cn('-mt-2 flex items-center gap-1.5 text-xs font-medium', ok ? 'text-ok' : 'text-warn')}>
      {ok ? <Check className="size-3.5" aria-hidden /> : null}
      {ok ? 'As senhas conferem' : 'As senhas ainda não conferem'}
    </p>
  );
}
