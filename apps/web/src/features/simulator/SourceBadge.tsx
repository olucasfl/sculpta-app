import type { ReconstructionSource } from '@sim/contracts';
import { Badge } from '../../components/ui/Card';

/** Selo obrigatório: deixa claro se o modelo é demonstrativo ou reconstruído, e a qualidade. */
export function SourceBadge({ source, qualityScore }: { source: ReconstructionSource; qualityScore: number | null }) {
  if (source === 'TEMPLATE') return <Badge tone="warn">Modelo demonstrativo (template genérico)</Badge>;
  const q = qualityScore === null ? null : qualityScore.toFixed(2).replace('.', ',');
  if (qualityScore !== null && qualityScore < 0.6) return <Badge tone="danger">Reconstrução · baixa qualidade ({q})</Badge>;
  return <Badge tone="ok">Reconstrução{source === 'FALLBACK_FIT' ? ' aproximada' : ''}{q ? ` · qualidade ${q}` : ''}</Badge>;
}
