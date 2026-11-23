/**
 * Motor do pincel de escultura (puro, sem three.js): adiciona volume, reduz volume, suaviza e apaga deslocamentos por vértice.
 * A malha base nunca é alterada: tudo fica em `offsets` (3 floats por vértice), que o visualizador aplica como um
 * morph target extra. Assim "antes" (sem deslocamentos) e "depois" convivem, e salvar uma versão guarda só os
 * vértices que mudaram (docs/GUIA-REFORMULACAO.md, 6.3).
 */

/**
 * add = adiciona volume (a superfície sobe, para fora, como um preenchimento); reduce = reduz volume (afunda, para dentro).
 * Os nomes antigos 'push' e 'pull' eram ambíguos: "empurrar" soa como ir para dentro, mas subia a pele.
 */
export type BrushTool = 'add' | 'reduce' | 'smooth' | 'erase';

export interface BrushParams {
  tool: BrushTool;
  /** Raio em unidades do modelo (o rosto tem ~0,2). */
  radius: number;
  /** 0 a 1. Quanto cada TRAÇO pode deslocar a pele no centro do pincel: `strength` x 3 mm. */
  strength: number;
  /** Pressão da caneta (mouse e dedo usam 1). */
  pressure: number;
  /** Espelha o traço em X (rosto simétrico). */
  symmetry: boolean;
}

/** Deslocamento máximo por vértice (evita aberrações). Em unidades do modelo. */
export const MAX_OFFSET = 0.008;
/** Deslocamento máximo de UM traço no centro do pincel, com força 1 e pressão 1 (3 mm). */
export const STROKE_DEPTH = 0.003;
/** Fração do que falta até o teto do traço que cada toque aplica (3 a 4 toques chegam perto do teto). */
const APPROACH = 0.45;
/** Quantização ao salvar: 0,01 mm se a unidade for o metro. */
const QUANT = 1e-5;

export interface SculptMesh {
  /** Posições base, 3 floats por vértice. */
  positions: Float32Array;
  /** Normais base, 3 floats por vértice. */
  normals: Float32Array;
  /** Triângulos, 3 índices cada. */
  indices: ArrayLike<number>;
  /** Vizinhos de cada vértice (por aresta). */
  neighbors: number[][];
  /** Triângulos que tocam cada vértice. */
  faces: number[][];
}

export function buildSculptMesh(positions: Float32Array, normals: Float32Array, indices: ArrayLike<number>): SculptMesh {
  const n = positions.length / 3;
  const neighborSets: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  const faces: number[][] = Array.from({ length: n }, () => []);
  for (let f = 0; f < indices.length; f += 3) {
    const a = indices[f]!, b = indices[f + 1]!, c = indices[f + 2]!;
    neighborSets[a]!.add(b).add(c);
    neighborSets[b]!.add(a).add(c);
    neighborSets[c]!.add(a).add(b);
    faces[a]!.push(f / 3);
    faces[b]!.push(f / 3);
    faces[c]!.push(f / 3);
  }
  return { positions, normals, indices, neighbors: neighborSets.map((s) => [...s]), faces };
}

/** Queda suave: 1 no centro, 0 na borda do raio. */
export function falloff(distance: number, radius: number): number {
  if (distance >= radius) return 0;
  const t = 1 - (distance / radius) ** 2;
  return t * t;
}

/**
 * Aplica um toque do pincel em `point` (coordenadas do modelo). Devolve os índices de vértices alterados.
 * Com simetria, repete o toque espelhado em X.
 */
export function applyBrush(
  mesh: SculptMesh,
  offsets: Float32Array,
  point: readonly [number, number, number],
  params: BrushParams,
  /** Chamado com os vértices que VÃO mudar, antes da mudança (para guardar o valor anterior e poder desfazer). */
  beforeChange?: (vertices: number[]) => void,
  /** Quanto cada vértice já recebeu NESTE traço (com sinal, ao longo da normal). Zere ao soltar o mouse. */
  stroke?: Float32Array,
  /**
   * Pesos da zona do procedimento (0 a 1 por vértice). Com `zone`, o pincel só age onde há peso (adicionar, reduzir e
   * suavizar); a borracha continua valendo em qualquer lugar, para sempre poder desfazer o que foi modelado.
   */
  zone?: ArrayLike<number> | null,
): number[] {
  const changed = new Set<number>();
  const centers: [number, number, number][] = [[point[0], point[1], point[2]]];
  if (params.symmetry) centers.push([-point[0], point[1], point[2]]);
  const acc = stroke ?? new Float32Array(mesh.positions.length / 3);
  for (const c of centers) stamp(mesh, offsets, c, params, changed, acc, zone ?? null, beforeChange);
  return [...changed];
}

function stamp(
  mesh: SculptMesh,
  offsets: Float32Array,
  c: [number, number, number],
  p: BrushParams,
  changed: Set<number>,
  stroke: Float32Array,
  zone: ArrayLike<number> | null,
  beforeChange?: (vertices: number[]) => void,
) {
  const { positions, normals, neighbors } = mesh;
  const n = positions.length / 3;
  const r2 = p.radius * p.radius;
  const depth = STROKE_DEPTH * p.strength * p.pressure;
  const inside: number[] = [];
  const weights: number[] = [];

  for (let v = 0; v < n; v++) {
    const i = v * 3;
    // Posição atual do vértice = base + deslocamento (o pincel "enxerga" o que já foi modelado).
    const dx = positions[i]! + offsets[i]! - c[0];
    const dy = positions[i + 1]! + offsets[i + 1]! - c[1];
    const dz = positions[i + 2]! + offsets[i + 2]! - c[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r2) continue;
    // preso à zona: fora dela nada muda; dentro, o peso da zona suaviza a borda (a borracha ignora a zona)
    const zw = zone && p.tool !== 'erase' ? (zone[v] ?? 0) : 1;
    if (zw <= 0.02) continue;
    inside.push(v);
    weights.push(falloff(Math.sqrt(d2), p.radius) * Math.min(1, zw * 1.5));
  }

  beforeChange?.(inside);

  if (p.tool === 'smooth') {
    // Move cada deslocamento em direção à média dos vizinhos (não puxa a malha base, só o que foi modelado).
    const next = new Map<number, [number, number, number]>();
    inside.forEach((v, k) => {
      const nb = neighbors[v]!;
      if (nb.length === 0) return;
      let sx = 0, sy = 0, sz = 0;
      for (const u of nb) {
        sx += offsets[u * 3]!;
        sy += offsets[u * 3 + 1]!;
        sz += offsets[u * 3 + 2]!;
      }
      const t = Math.min(1, weights[k]! * p.strength * p.pressure * 0.6);
      next.set(v, [
        offsets[v * 3]! + (sx / nb.length - offsets[v * 3]!) * t,
        offsets[v * 3 + 1]! + (sy / nb.length - offsets[v * 3 + 1]!) * t,
        offsets[v * 3 + 2]! + (sz / nb.length - offsets[v * 3 + 2]!) * t,
      ]);
    });
    for (const [v, o] of next) {
      offsets[v * 3] = o[0];
      offsets[v * 3 + 1] = o[1];
      offsets[v * 3 + 2] = o[2];
      changed.add(v);
    }
    return;
  }

  inside.forEach((v, k) => {
    const i = v * 3;
    const w = weights[k]!;
    if (p.tool === 'erase') {
      const keep = 1 - Math.min(1, w * p.strength * p.pressure * 0.5);
      offsets[i] = offsets[i]! * keep;
      offsets[i + 1] = offsets[i + 1]! * keep;
      offsets[i + 2] = offsets[i + 2]! * keep;
    } else {
      // Teto do traço: no máximo `depth` no centro, caindo até 0 na borda. Não depende de quantos toques nem de quanto
      // o mouse demora (antes, parar o mouse empilhava toques e o efeito saía exagerado e imprevisível).
      const sign = p.tool === 'add' ? 1 : -1;
      const target = sign * depth * w;
      const acc = stroke[v]!;
      if (Math.abs(target) > Math.abs(acc) || Math.sign(target) !== Math.sign(acc)) {
        const next = acc + (target - acc) * APPROACH;
        const step = next - acc;
        stroke[v] = next;
        offsets[i] = offsets[i]! + normals[i]! * step;
        offsets[i + 1] = offsets[i + 1]! + normals[i + 1]! * step;
        offsets[i + 2] = offsets[i + 2]! + normals[i + 2]! * step;
        clampOffset(offsets, i);
      }
    }
    changed.add(v);
  });
}

function clampOffset(offsets: Float32Array, i: number) {
  const x = offsets[i]!, y = offsets[i + 1]!, z = offsets[i + 2]!;
  const len = Math.hypot(x, y, z);
  if (len > MAX_OFFSET) {
    const k = MAX_OFFSET / len;
    offsets[i] = x * k;
    offsets[i + 1] = y * k;
    offsets[i + 2] = z * k;
  }
}

/**
 * Recalcula as normais dos vértices tocados (e vizinhos) a partir de base + deslocamentos.
 * Devolve, por vértice, o DELTA de normal em relação à normal base (é o que o morph target usa).
 */
export function updateNormalDeltas(mesh: SculptMesh, offsets: Float32Array, normalDeltas: Float32Array, changed: number[]): number[] {
  const { positions, normals, indices, neighbors, faces } = mesh;
  const touched = new Set<number>(changed);
  for (const v of changed) for (const u of neighbors[v]!) touched.add(u);

  const faceNormal = (f: number): [number, number, number] => {
    const a = indices[f * 3]! * 3, b = indices[f * 3 + 1]! * 3, c = indices[f * 3 + 2]! * 3;
    const ax = positions[a]! + offsets[a]!, ay = positions[a + 1]! + offsets[a + 1]!, az = positions[a + 2]! + offsets[a + 2]!;
    const e1x = positions[b]! + offsets[b]! - ax, e1y = positions[b + 1]! + offsets[b + 1]! - ay, e1z = positions[b + 2]! + offsets[b + 2]! - az;
    const e2x = positions[c]! + offsets[c]! - ax, e2y = positions[c + 1]! + offsets[c + 1]! - ay, e2z = positions[c + 2]! + offsets[c + 2]! - az;
    return [e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x];
  };

  for (const v of touched) {
    let x = 0, y = 0, z = 0;
    for (const f of faces[v]!) {
      const fn = faceNormal(f);
      x += fn[0];
      y += fn[1];
      z += fn[2];
    }
    const len = Math.hypot(x, y, z) || 1;
    const i = v * 3;
    normalDeltas[i] = x / len - normals[i]!;
    normalDeltas[i + 1] = y / len - normals[i + 1]!;
    normalDeltas[i + 2] = z / len - normals[i + 2]!;
  }
  return [...touched];
}

// ---------------------------------------------------------------- desfazer por traço

export interface Stroke {
  indices: number[];
  before: Float32Array;
}

/** Guarda, por traço, o valor ANTERIOR dos vértices tocados, para desfazer e refazer. */
export class StrokeHistory {
  private undoStack: Stroke[] = [];
  private redoStack: Stroke[] = [];
  private current: Map<number, [number, number, number]> | null = null;

  constructor(private readonly limit = 60) {}

  /** Chamar ANTES de aplicar cada toque do traço, com os vértices que serão alterados. */
  touch(offsets: Float32Array, vertices: Iterable<number>) {
    if (!this.current) this.current = new Map();
    for (const v of vertices) {
      if (!this.current.has(v)) this.current.set(v, [offsets[v * 3]!, offsets[v * 3 + 1]!, offsets[v * 3 + 2]!]);
    }
  }

  endStroke() {
    if (!this.current || this.current.size === 0) {
      this.current = null;
      return;
    }
    const indices = [...this.current.keys()];
    const before = new Float32Array(indices.length * 3);
    indices.forEach((v, k) => before.set(this.current!.get(v)!, k * 3));
    this.undoStack.push({ indices, before });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.current = null;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  /** Desfaz o último traço; devolve os vértices alterados (ou `null`). */
  undo(offsets: Float32Array): number[] | null {
    const s = this.undoStack.pop();
    if (!s) return null;
    this.redoStack.push(swap(offsets, s));
    return s.indices;
  }

  redo(offsets: Float32Array): number[] | null {
    const s = this.redoStack.pop();
    if (!s) return null;
    this.undoStack.push(swap(offsets, s));
    return s.indices;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.current = null;
  }
}

/** Troca os valores do traço pelos que estão em `offsets` e devolve o traço inverso. */
function swap(offsets: Float32Array, s: Stroke): Stroke {
  const now = new Float32Array(s.indices.length * 3);
  s.indices.forEach((v, k) => {
    now.set([offsets[v * 3]!, offsets[v * 3 + 1]!, offsets[v * 3 + 2]!], k * 3);
    offsets.set(s.before.subarray(k * 3, k * 3 + 3), v * 3);
  });
  return { indices: s.indices, before: now };
}

// ---------------------------------------------------------------- salvar e carregar

export interface SculptData {
  v: 1;
  /** Total de vértices da malha (confere ao carregar). */
  n: number;
  /** Índices dos vértices alterados (Uint32 little-endian, base64). */
  i: string;
  /** Deslocamentos x,y,z de cada um, em múltiplos de 1e-5 (Int16 little-endian, base64). */
  d: string;
}

const toBase64 = (b: Uint8Array) => {
  let s = '';
  for (let k = 0; k < b.length; k += 0x8000) s += String.fromCharCode(...b.subarray(k, k + 0x8000));
  return btoa(s);
};
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Guarda só os vértices com deslocamento (esparso e quantizado). `null` se não há nada modelado. */
export function encodeOffsets(offsets: Float32Array): SculptData | null {
  const idx: number[] = [];
  for (let v = 0; v < offsets.length / 3; v++) {
    if (Math.abs(offsets[v * 3]!) >= QUANT / 2 || Math.abs(offsets[v * 3 + 1]!) >= QUANT / 2 || Math.abs(offsets[v * 3 + 2]!) >= QUANT / 2) idx.push(v);
  }
  if (idx.length === 0) return null;
  const i32 = new Uint32Array(idx);
  const d16 = new Int16Array(idx.length * 3);
  idx.forEach((v, k) => {
    for (let c = 0; c < 3; c++) d16[k * 3 + c] = Math.max(-32767, Math.min(32767, Math.round(offsets[v * 3 + c]! / QUANT)));
  });
  return { v: 1, n: offsets.length / 3, i: toBase64(new Uint8Array(i32.buffer)), d: toBase64(new Uint8Array(d16.buffer)) };
}

/** Lê o que `encodeOffsets` gravou. Recusa dados que não batem com a malha (outro modelo, corrompido). */
export function decodeOffsets(data: SculptData, vertexCount: number): Float32Array {
  if (data.v !== 1 || data.n !== vertexCount) throw new Error('Os deslocamentos salvos não são desta malha');
  const ib = fromBase64(data.i);
  const db = fromBase64(data.d);
  const idx = new Uint32Array(ib.buffer.slice(ib.byteOffset, ib.byteOffset + ib.byteLength));
  const d16 = new Int16Array(db.buffer.slice(db.byteOffset, db.byteOffset + db.byteLength));
  if (d16.length !== idx.length * 3) throw new Error('Deslocamentos salvos corrompidos');
  const out = new Float32Array(vertexCount * 3);
  idx.forEach((v, k) => {
    if (v >= vertexCount) throw new Error('Deslocamentos salvos corrompidos');
    for (let c = 0; c < 3; c++) out[v * 3 + c] = d16[k * 3 + c]! * QUANT;
  });
  return out;
}
