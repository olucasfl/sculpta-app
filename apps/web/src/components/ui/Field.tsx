import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/format';

const control =
  'w-full rounded-lg border bg-surface px-3 text-base text-ink placeholder:text-faint transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-subtle';

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  children: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string; className: string }) => ReactNode;
}

/** Rótulo, controle, dica e erro ligados por id (leitores de tela anunciam o erro). */
export function Field({ label, error, hint, optional, children }: FieldProps) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {optional && <span className="ml-1 font-normal text-faint">(opcional)</span>}
      </label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
        className: cn(control, error ? 'border-danger' : 'border-field'),
      })}
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

type Common = { label: string; error?: string; hint?: string; optional?: boolean };

export function TextField({ label, error, hint, optional, className, ...rest }: Common & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} error={error} hint={hint} optional={optional}>
      {(p) => <input {...rest} {...p} className={cn(p.className, 'h-10', className)} />}
    </Field>
  );
}

export function TextAreaField({ label, error, hint, optional, className, ...rest }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} error={error} hint={hint} optional={optional}>
      {(p) => <textarea rows={3} {...rest} {...p} className={cn(p.className, 'py-2', className)} />}
    </Field>
  );
}

export function SelectField({ label, error, hint, optional, className, children, ...rest }: Common & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} error={error} hint={hint} optional={optional}>
      {(p) => (
        <select {...rest} {...p} className={cn(p.className, 'h-10', className)}>
          {children}
        </select>
      )}
    </Field>
  );
}
