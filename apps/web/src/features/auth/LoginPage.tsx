import { LoginRequest } from '@sim/contracts';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { errorMessage, login } from '../../lib/api';
import { useAuth } from '../../lib/auth-store';

export function LoginPage() {
  const status = useAuth((s) => s.status);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (status === 'authenticated') return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = LoginRequest.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      await login(parsed.data);
      navigate(from, { replace: true });
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-xl bg-accent text-lg font-semibold text-white" aria-hidden>
            S
          </div>
          <h1 className="text-xl font-semibold">Simulador Estético 3D</h1>
          <p className="mt-1 text-sm text-muted">Entre com o e-mail da clínica</p>
        </div>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6 shadow-card">
          <TextField label="E-mail" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} autoFocus />
          <TextField label="Senha" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
          {formError && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {formError}
            </p>
          )}
          <Button type="submit" loading={loading} className="mt-1 w-full">
            Entrar
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-muted">
          Simulações são ilustrativas e não garantem resultado.
        </p>
      </div>
    </main>
  );
}
