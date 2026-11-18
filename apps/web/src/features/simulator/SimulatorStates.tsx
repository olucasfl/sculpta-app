import { AlertTriangle, MonitorOff } from 'lucide-react';
import { Link } from 'react-router';
import { ButtonLink } from '../../components/ui/Button';

function Screen({ icon, title, children, actions }: { icon: React.ReactNode; title: string; children: React.ReactNode; actions: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-canvas px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 text-center shadow-card">
        <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-warn-soft text-warn">{icon}</span>
        <h1 className="text-xl font-semibold">{title}</h1>
        <div className="mt-2 space-y-2 text-muted">{children}</div>
        <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>
      </div>
    </div>
  );
}

/** Modelo com confiança baixa: o app recusa mostrar um rosto que a captura não sustenta. */
export function LowConfidenceScreen({ patientId, score }: { patientId: string; score: number | null }) {
  return (
    <Screen
      icon={<AlertTriangle className="size-6" aria-hidden />}
      title="Confiança baixa do modelo"
      actions={
        <>
          <ButtonLink to={`/patients/${patientId}`}>Refazer a captura</ButtonLink>
          <Link to="/simulations" className="inline-flex min-h-11 items-center px-3 text-sm text-muted hover:text-ink">
            Voltar às simulações
          </Link>
        </>
      }
    >
      <p>
        A reconstrução deste paciente ficou com qualidade{score === null ? ' desconhecida' : ` ${score.toFixed(2).replace('.', ',')}`}, abaixo do mínimo para simular. Mostrar um rosto que as fotos não
        sustentam seria enganoso.
      </p>
      <p className="text-sm">Refaça a captura com mais luz, rosto centralizado e foco em todas as vistas.</p>
    </Screen>
  );
}

/** Sem WebGL o simulador 3D não funciona: explica em vez de mostrar uma tela em branco. */
export function NoWebglScreen({ patientId }: { patientId: string }) {
  return (
    <Screen
      icon={<MonitorOff className="size-6" aria-hidden />}
      title="Este aparelho não consegue mostrar o 3D"
      actions={<ButtonLink to={`/patients/${patientId}`}>Voltar ao paciente</ButtonLink>}
    >
      <p>O simulador precisa de WebGL, que está desligado ou não existe neste navegador ou aparelho.</p>
      <p className="text-sm">Tente outro navegador (Chrome, Edge, Safari atualizados), ative a aceleração de hardware ou use outro aparelho.</p>
    </Screen>
  );
}
