import { ANGLE_RULES, type PhotoAngle } from '@sim/contracts';
import { CheckCircle2, Circle, XCircle } from 'lucide-react';
import type { Check } from './vision/analysis';

export function CaptureChecks({ checks }: { checks: Check[] }) {
  if (checks.length === 0) return null;
  return (
    <ul className="space-y-1.5 text-sm" aria-live="polite">
      {checks.map((c) => (
        <li key={c.id} className="flex items-start gap-2">
          {c.ok ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
          ) : (
            <XCircle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          )}
          <span>
            <span className={c.ok ? 'text-ink' : 'font-medium text-ink'}>{c.label}</span>
            {c.hint && <span className="block text-xs text-muted">{c.hint}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CaptureTips() {
  return (
    <ul className="space-y-1 text-xs text-muted">
      {['Luz frontal e uniforme, sem sombra forte', 'Cabelo preso, rosto e orelhas visíveis', 'Sem óculos, expressão neutra', 'Fundo liso, câmera na altura dos olhos'].map((t) => (
        <li key={t} className="flex gap-2">
          <Circle className="mt-1 size-2 shrink-0 fill-current" aria-hidden /> {t}
        </li>
      ))}
    </ul>
  );
}

/** Guia de enquadramento sobre a câmera: oval alvo (40–70% da altura) e direção do giro. */
export function AngleGuide({ angle, ready, progress = 0 }: { angle: PhotoAngle; ready: boolean; progress?: number }) {
  const rule = ANGLE_RULES[angle];
  const target = (rule.yawMin + rule.yawMax) / 2;
  const color = ready ? '#067647' : '#ffffff';
  return (
    <svg viewBox="0 0 300 400" className="pointer-events-none absolute inset-0 size-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <defs>
        <mask id="guide-hole">
          <rect width="300" height="400" fill="white" />
          <ellipse cx="150" cy="195" rx="85" ry="115" fill="black" />
        </mask>
      </defs>
      <rect width="300" height="400" fill="rgb(0 0 0 / 0.28)" mask="url(#guide-hole)" />
      <ellipse cx="150" cy="195" rx="85" ry="115" fill="none" stroke={color} strokeWidth="3" strokeDasharray={ready ? undefined : '8 6'} />
      {/* Anel de contagem da foto automática */}
      {progress > 0 && (
        <ellipse cx="150" cy="195" rx="93" ry="123" fill="none" stroke="#5eead4" strokeWidth="6" strokeLinecap="round" pathLength={100} strokeDasharray={`${Math.round(progress * 100)} 100`} transform="rotate(-90 150 195)" />
      )}
      {/* Mira: ponto no centro do rosto alvo */}
      <circle cx="150" cy="195" r="4" fill={color} opacity="0.8" />
      {rule.pitchMin !== undefined && rule.pitchMin > 0 && (
        <path d="M 150 50 L 150 20 M 138 32 L 150 20 L 162 32" stroke="white" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {rule.pitchMax !== undefined && rule.pitchMax < 0 && (
        <path d="M 150 340 L 150 370 M 138 358 L 150 370 L 162 358" stroke="white" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {target !== 0 && (
        <g transform={`translate(150 360) scale(${target > 0 ? -1 : 1} 1)`}>
          <path d="M -40 0 L 30 0 M 18 -12 L 32 0 L 18 12" stroke="white" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
    </svg>
  );
}
