import { SLIDERS, type FaceRegion, type SimulationParams, type SliderId } from '@sim/contracts';

/**
 * Estado dos sliders com histórico (desfazer/refazer). Funções puras, testadas à parte.
 * `live` muda a cada movimento do slider; o histórico só registra ao soltar (`commit`).
 */
export interface History {
  live: SimulationParams;
  committed: SimulationParams;
  past: SimulationParams[];
  future: SimulationParams[];
}

const LIMIT = 100;
const sliderMin = new Map<SliderId, number>(SLIDERS.map((s) => [s.id, s.min]));

export const emptyHistory = (params: SimulationParams = {}): History => ({
  live: params,
  committed: params,
  past: [],
  future: [],
});

/** Remove zeros e limita ao intervalo do slider. */
export function normalize(params: SimulationParams): SimulationParams {
  const out: SimulationParams = {};
  for (const [id, v] of Object.entries(params) as [SliderId, number][]) {
    const min = sliderMin.get(id);
    if (min === undefined || !Number.isFinite(v)) continue;
    const c = Math.round(Math.min(1, Math.max(min, v)) * 100) / 100;
    if (c !== 0) out[id] = c;
  }
  return out;
}

const same = (a: SimulationParams, b: SimulationParams) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

export function setLive(h: History, id: SliderId, value: number): History {
  return { ...h, live: normalize({ ...h.live, [id]: value }) };
}

export function commit(h: History): History {
  if (same(h.live, h.committed)) return h;
  return { live: h.live, committed: h.live, past: [...h.past, h.committed].slice(-LIMIT), future: [] };
}

/** Aplica uma mudança completa (reset, carregar versão) já registrando no histórico. */
export function apply(h: History, params: SimulationParams): History {
  return commit({ ...h, live: normalize(params) });
}

export function undo(h: History): History {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return { live: prev, committed: prev, past: h.past.slice(0, -1), future: [h.committed, ...h.future] };
}

export function redo(h: History): History {
  const next = h.future[0];
  if (!next) return h;
  return { live: next, committed: next, past: [...h.past, h.committed], future: h.future.slice(1) };
}

export function resetRegion(h: History, region: FaceRegion): History {
  const ids = new Set(SLIDERS.filter((s) => s.region === region).map((s) => s.id));
  const next = Object.fromEntries(Object.entries(h.committed).filter(([k]) => !ids.has(k as SliderId)));
  return apply(h, next);
}

export const regionHasChanges = (params: SimulationParams, region: FaceRegion) =>
  SLIDERS.some((s) => s.region === region && (params[s.id] ?? 0) !== 0);
