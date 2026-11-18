import { SignupRequest } from '@sim/contracts';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { MatchHint, PasswordField } from '../../components/ui/PasswordField';
import { toast } from '../../components/ui/Toaster';
import { ApiError, errorMessage, signup } from '../../lib/api';
import { useAuth } from '../../lib/auth-store';
import { AuthLayout } from './AuthLayout';

/**
 * Criar conta, com a senha digitada duas vezes. Não dá acesso a nenhuma clínica por si só: quem
 * convida a pessoa (pelo e-mail) libera a entrada. Sem verificação de e-mail por enquanto.
 */
export function SignupPage() {
  const status = useAuth((s) => s.status);
  const navigate = useNavigate();
  const [v, setV] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (status === 'authenticated') return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = SignupRequest.safeParse(v);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      const data = await signup(parsed.data);
      for (const c of data.user.joined ?? []) toast.ok(`Você foi adicionado à ${c.name}.`);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setErrors(err.fieldErrors());
      else setFormError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Criar conta"
      subtitle="Use o mesmo e-mail em que você foi convidado: se uma clínica convidou esse e-mail, você entra nela automaticamente."
      footer={
        <p>
          Já tem conta?{' '}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Entrar
          </Link>
        </p>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextField label="Nome completo" autoComplete="name" value={v.name} error={errors.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus />
        <TextField label="E-mail" type="email" autoComplete="username" inputMode="email" value={v.email} error={errors.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        <PasswordField
          label="Senha"
          meter
          autoComplete="new-password"
          value={v.password}
          error={errors.password}
          hint="Ao menos 10 caracteres. Misture letras maiúsculas e minúsculas, números e símbolos."
          onChange={(e) => setV({ ...v, password: e.target.value })}
        />
        <PasswordField
          label="Confirme a senha"
          autoComplete="new-password"
          value={v.confirmPassword}
          error={errors.confirmPassword}
          onChange={(e) => setV({ ...v, confirmPassword: e.target.value })}
        />
        {!errors.confirmPassword && <MatchHint a={v.password} b={v.confirmPassword} />}
        {formError && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        )}
        <Button type="submit" loading={loading} className="mt-1 h-11 w-full">
          Criar conta
        </Button>
      </form>
    </AuthLayout>
  );
}
