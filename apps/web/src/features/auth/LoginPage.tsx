import { LoginRequest } from '@sim/contracts';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { PasswordField } from '../../components/ui/PasswordField';
import { toast } from '../../components/ui/Toaster';
import { errorMessage, login } from '../../lib/api';
import { useAuth } from '../../lib/auth-store';
import { AuthLayout } from './AuthLayout';

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
      const data = await login(parsed.data);
      for (const c of data.user.joined ?? []) toast.ok(`Você foi adicionado à ${c.name}.`);
      navigate(from, { replace: true });
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Entrar"
      subtitle="Acesse com o e-mail e a senha da sua conta."
      footer={
        <>
          <p>
            Ainda não tem conta?{' '}
            <Link to="/cadastro" className="font-medium text-accent hover:underline">
              Criar conta
            </Link>
          </p>
          <p className="mt-3 text-xs">Esqueceu a senha? A recuperação por e-mail ainda não existe; peça ao administrador.</p>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextField label="E-mail" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} autoFocus />
        <PasswordField label="Senha" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        {formError && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        )}
        <Button type="submit" loading={loading} className="mt-1 h-11 w-full">
          Entrar
        </Button>
      </form>
    </AuthLayout>
  );
}
