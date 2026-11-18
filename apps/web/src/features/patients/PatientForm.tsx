import { PatientCreate, type Patient } from '@sim/contracts';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { TextAreaField, TextField } from '../../components/ui/Field';
import { ApiError, errorMessage } from '../../lib/api';

export type PatientFormValues = Record<'name' | 'internalCode' | 'phone' | 'birthDate' | 'notes', string>;

const fromPatient = (p?: Patient): PatientFormValues => ({
  name: p?.name ?? '',
  internalCode: p?.internalCode ?? '',
  phone: p?.phone ?? '',
  birthDate: p?.birthDate ?? '',
  notes: p?.notes ?? '',
});

interface Props {
  initial?: Patient;
  submitLabel: string;
  onSubmit: (values: PatientCreate) => Promise<unknown>;
  onCancel: () => void;
}

/**
 * Valida no navegador com o mesmo schema da API (@sim/contracts) e mostra também
 * os erros que a API devolver por campo.
 */
export function PatientForm({ initial, submitLabel, onSubmit, onCancel }: Props) {
  const [values, setValues] = useState(() => fromPatient(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof PatientFormValues) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = PatientCreate.safeParse(values);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await onSubmit(parsed.data);
    } catch (err) {
      if (err instanceof ApiError && err.body.details) setErrors(err.fieldErrors());
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <TextField label="Nome" value={values.name} onChange={set('name')} error={errors.name} autoComplete="off" required autoFocus />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Código interno"
          optional
          value={values.internalCode}
          onChange={set('internalCode')}
          error={errors.internalCode}
          hint="Prontuário ou ficha da clínica"
        />
        <TextField label="Telefone" optional type="tel" value={values.phone} onChange={set('phone')} error={errors.phone} />
      </div>
      <TextField
        label="Data de nascimento"
        optional
        type="date"
        value={values.birthDate}
        onChange={set('birthDate')}
        error={errors.birthDate}
        className="sm:max-w-[12rem]"
      />
      <TextAreaField label="Observações" optional value={values.notes} onChange={set('notes')} error={errors.notes} />
      <p className="text-xs text-muted">Colete só o necessário para o atendimento. Só o nome é obrigatório.</p>
      {formError && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {formError}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button type="submit" loading={saving}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
