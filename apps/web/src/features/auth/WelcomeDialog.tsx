import { Box, Camera, FileSignature, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { useAuth } from '../../lib/auth-store';

const POINTS = [
  { icon: <FileSignature className="size-5" aria-hidden />, title: 'Termo de consentimento digital', text: 'Assinatura na tela, com escopos separados. Revogar o termo apaga os dados biométricos do paciente.' },
  { icon: <Camera className="size-5" aria-hidden />, title: 'Captura facial guiada', text: 'As fotos são validadas no próprio aparelho, antes de qualquer envio.' },
  { icon: <Box className="size-5" aria-hidden />, title: 'Simulação 3D antes e depois', text: 'Ajustes por região, com versões salvas e imagem para mostrar ao paciente.' },
  { icon: <ShieldCheck className="size-5" aria-hidden />, title: 'Cada clínica no seu espaço', text: 'Pacientes e arquivos ficam separados por clínica, com registro de quem acessou.' },
];

const key = (userId: string) => `sculpta.welcome.${userId}`;

function seen(userId: string): boolean {
  try {
    return localStorage.getItem(key(userId)) === '1';
  } catch {
    return false;
  }
}

/**
 * Boas-vindas na primeira vez que a pessoa entra no app. "Primeira vez" é por aparelho e navegador
 * (fica no localStorage): em outro aparelho, aparece de novo uma vez.
 */
export function WelcomeDialog() {
  const user = useAuth((s) => s.user);
  const [open, setOpen] = useState(() => (user ? !seen(user.id) : false));
  if (!user) return null;

  const close = () => {
    try {
      localStorage.setItem(key(user.id), '1');
    } catch {
      /* sem armazenamento: aparece de novo na próxima vez */
    }
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Bem-vindo(a) ao Sculpta, ${user.name.split(' ')[0]}`}
      description="Um resumo rápido do que você encontra aqui."
      footer={<Button onClick={close}>Começar</Button>}
    >
      <ul className="space-y-5">
        {POINTS.map((p) => (
          <li key={p.title} className="flex gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-ink">{p.icon}</span>
            <span>
              <span className="block font-medium">{p.title}</span>
              <span className="block text-sm text-muted">{p.text}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-6 rounded-lg bg-subtle px-3 py-2 text-xs text-muted">
        A simulação é ilustrativa e não garante resultado. O sistema não recomenda procedimentos nem indica produto, dose ou técnica.
      </p>
    </Dialog>
  );
}
