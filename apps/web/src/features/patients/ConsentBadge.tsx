import type { ConsentState } from '@sim/contracts';
import { ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react';
import { Badge } from '../../components/ui/Card';

export function ConsentBadge({ state }: { state: ConsentState }) {
  if (state === 'ACTIVE')
    return (
      <Badge tone="ok">
        <ShieldCheck className="size-3.5" aria-hidden /> Termo ativo
      </Badge>
    );
  if (state === 'REVOKED')
    return (
      <Badge tone="danger">
        <ShieldOff className="size-3.5" aria-hidden /> Termo revogado
      </Badge>
    );
  return (
    <Badge tone="warn">
      <ShieldAlert className="size-3.5" aria-hidden /> Sem termo
    </Badge>
  );
}
