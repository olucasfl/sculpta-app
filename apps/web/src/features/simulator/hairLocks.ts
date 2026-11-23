/**
 * Mechas de cabelo: cada fio-guia (ver hairStrands.ts) vira uma fita que sempre olha para a câmera, com espessura,
 * ponta afinada, onda, abertura nas pontas e volume em camadas. O desenho dos fios finos dentro da fita e o brilho
 * ficam no sombreador (hairMaterial.ts). É a técnica de "hair cards" dos jogos, aplicada a guias gerados da foto.
 */
import type { HeadShape, StrandPath } from './hairStrands';
import { mulberry32 } from './hairStrands';
import { followWeight } from './hairDeform';

export interface LockOptions {
  /** Cor base (linear, 0 a 1) para guias sem cor lida da foto. */
  base: [number, number, number];
  /** 0 a 1: ondas largas. */
  wave: number;
  /** 0 a 1: cabelo que fica em pé / volumoso (infla mais as camadas externas). */
  puff: number;
  seed?: number;
  /** Vértice da cabeça mais próximo de um ponto e a distância até ele (ver `Strands.attach`). */
  attach?: (q: number[]) => [number, number];
}

export interface LockGeometry {
  position: Float32Array;
  tangent: Float32Array;
  /** -1 ou 1: lado da fita. */
  side: Float32Array;
  /** 0 na raiz, 1 na ponta. */
  along: Float32Array;
  /** Largura da mecha (m), camada (0 interna, 1 externa) e semente da mecha. */
  info: Float32Array;
  color: Float32Array;
  index: Uint32Array;
  locks: number;
  /** Vértice da cabeça a que cada ponto se prende e o peso com que o segue (ver hairDeform.ts). */
  attachIndex: Int32Array;
  attachWeight: Float32Array;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const norm3 = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};

/** Deixa o cabelo com volume: camadas de fora mais afastadas da cabeça, abertura (flare) nas laterais, onda. */
export function shapeLock(path: StrandPath, head: HeadShape, o: LockOptions, rnd: () => number): number[][] {
  const n = path.pts.length;
  const layer = rnd();
  const inflate = 0.07 + 0.14 * o.puff;
  const ptsIn = path.pts.map((p) => p.slice());
  // comprimento acumulado (m) para a onda ter comprimento de onda constante
  const sArr = [0];
  for (let k = 1; k < n; k++) {
    const a = ptsIn[k - 1]!, b = ptsIn[k]!;
    sArr.push(sArr[k - 1]! + Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!));
  }
  const root = ptsIn[0]!;
  // fase comum a mechas vizinhas: as ondas formam frentes, não ruído
  const phase0 = root[0]! * 38 + root[2]! * 24 + root[1]! * 12 + rnd() * 0.8;
  const wavelength = 0.075 + 0.02 * layer;
  const amp = o.wave * 0.017 * Math.min(1, path.len * 9);
  const long = path.len > 0.12;
  const out: number[][] = [];
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const p = ptsIn[k]!;
    // tangente do caminho original, para a direção lateral da onda
    const a = ptsIn[Math.max(0, k - 1)]!, b = ptsIn[Math.min(n - 1, k + 1)]!;
    const T = norm3(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!);
    let lx = T[1]! * 0 - T[2]! * 1; // T x (0,1,0)
    let lz = T[0]! * 1 - T[1]! * 0;
    if (Math.hypot(lx, lz) < 1e-3) { lx = 1; lz = 0; }
    const l = norm3(lx, 0, lz);
    let x = p[0]!;
    const y = p[1]!;
    let z = p[2]!;
    // volume: afasta a camada do centro da cabeça (x e z), mais forte nas camadas de fora
    const f = 1 + inflate * layer * smooth(0, 0.22, t);
    x *= f;
    z = head.cz + (z - head.cz) * f;
    // abertura: abaixo do maxilar o cabelo longo se alarga para os lados, como ao chegar nos ombros
    if (long && y < head.yb) {
      x += Math.sign(x || (rnd() - 0.5)) * Math.min(0.12, (head.yb - y) * 0.28) * smooth(0, 1, t) * (0.5 + 0.5 * layer);
    }
    // onda
    const w = amp * smooth(0, 0.28, t) * Math.sin(phase0 + (2 * Math.PI * sArr[k]!) / wavelength);
    x += l[0]! * w;
    z += l[2]! * w;
    out.push([x, y, z]);
  }
  out[0] = path.pts[0]!.slice(); // a raiz fica onde nasce
  return out;
}

export function buildLocks(paths: StrandPath[], head: HeadShape, o: LockOptions): LockGeometry {
  const rnd = mulberry32((o.seed ?? 1) + 977);
  const total = paths.filter((p) => p.pts.length >= 2).length;
  const nVerts = paths.reduce((a, p) => a + (p.pts.length >= 2 ? p.pts.length * 2 : 0), 0);
  const nQuads = paths.reduce((a, p) => a + (p.pts.length >= 2 ? p.pts.length - 1 : 0), 0);
  const position = new Float32Array(nVerts * 3);
  const tangent = new Float32Array(nVerts * 3);
  const side = new Float32Array(nVerts);
  const along = new Float32Array(nVerts);
  const info = new Float32Array(nVerts * 3);
  const color = new Float32Array(nVerts * 3);
  const index = new Uint32Array(nQuads * 6);
  const attachIndex = new Int32Array(nVerts).fill(-1);
  const attachWeight = new Float32Array(nVerts);
  let v = 0;
  let q = 0;
  for (const path of paths) {
    if (path.pts.length < 2) continue;
    const seed = rnd();
    const layer = seed; // a camada vem da mesma sorteio da semente (mechas internas ficam mais escuras)
    const pts = shapeLock(path, head, o, mulberry32(Math.floor(seed * 1e9)));
    const n = pts.length;
    const base = path.rgb ?? o.base;
    const hl = rnd() < 0.2 ? 1.28 + rnd() * 0.25 : 1; // algumas mechas mais claras (reflexos)
    const tone = (0.86 + 0.28 * rnd()) * hl;
    const warm = hl > 1 ? [1.08, 1.0, 0.86] : [1, 1, 1];
    const width = Math.min(0.011, Math.max(0.0035, path.len * 0.06)) * (0.8 + 0.4 * rnd());
    const v0 = v;
    let lastIdx = -1;
    for (let k = 0; k < n; k++) {
      let ai = -1;
      let aw = 0;
      if (o.attach) {
        const [i, d] = o.attach(path.pts[k]!);
        if (i >= 0) {
          lastIdx = i;
          ai = i;
          aw = followWeight(d);
        } else if (lastIdx >= 0) {
          ai = lastIdx; // longe da pele: segue a última raiz, com pouco peso
          aw = 0.3;
        }
      }
      const a = pts[Math.max(0, k - 1)]!, b = pts[Math.min(n - 1, k + 1)]!;
      const T = norm3(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!);
      for (const s of [-1, 1]) {
        position.set(pts[k]!, v * 3);
        tangent.set(T, v * 3);
        side[v] = s;
        along[v] = k / (n - 1);
        attachIndex[v] = ai;
        attachWeight[v] = aw;
        info[v * 3] = width;
        info[v * 3 + 1] = layer;
        info[v * 3 + 2] = seed;
        color[v * 3] = Math.min(1, base[0] * tone * warm[0]!);
        color[v * 3 + 1] = Math.min(1, base[1] * tone * warm[1]!);
        color[v * 3 + 2] = Math.min(1, base[2] * tone * warm[2]!);
        v++;
      }
    }
    for (let k = 0; k < n - 1; k++) {
      const a = v0 + k * 2;
      index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], q * 6);
      q++;
    }
  }
  return { position, tangent, side, along, info, color, index, locks: total, attachIndex, attachWeight };
}
