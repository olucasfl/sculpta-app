/**
 * Cabelo em fios (E8): fios crescem da superfície do couro cabeludo, só onde o modelo diz que há cabelo
 * (atributo `_HAIR` do .glb, medido na textura das fotos), com a cor média do cabelo da pessoa.
 *
 * É uma representação VISUAL: cada fio é uma linha de poucos segmentos que sai da superfície, sobe um pouco e cai
 * com a gravidade, em fluxo radial a partir da coroa (na frente vai para frente e para baixo, atrás desce).
 * Não simula física, penteado real nem o corte do paciente; o comprimento e a densidade vêm de controles.
 */

export interface StrandParams {
  /** Fios por cm² de couro cabeludo coberto de cabelo. */
  density: number;
  /** Comprimento médio do fio, em metros. */
  length: number;
  seed?: number;
  segments?: number;
  /** Altura dos olhos e plano da frente do rosto: os fios da frente não passam da sobrancelha (não cobrem os olhos). */
  eyeY?: number;
  faceZ?: number;
}

export interface Strands {
  /** Pares de pontos (início e fim de cada segmento), 6 floats por segmento. */
  positions: Float32Array;
  /** Um tom (0,6 a 1,1) por vértice de segmento, para variar o brilho dos fios. */
  shade: Float32Array;
  strands: number;
  segments: number;
}

/** Gerador pseudoaleatório determinístico (o mesmo rosto sempre gera o mesmo cabelo). */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const norm = (v: number[]) => {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
  return [v[0]! / l, v[1]! / l, v[2]! / l];
};

export function buildStrands(
  pos: ArrayLike<number>,
  nor: ArrayLike<number>,
  idx: ArrayLike<number>,
  hair: ArrayLike<number>,
  p: StrandParams,
): Strands {
  const segs = p.segments ?? 6;
  const rnd = mulberry32(p.seed ?? 1);
  const nv = pos.length / 3;

  // Coroa: o ponto mais alto entre os vértices com cabelo, um pouco para trás. O fluxo irradia dela.
  let top = -Infinity;
  const crown = [0, 0, 0];
  for (let i = 0; i < nv; i++) {
    if (hair[i]! > 0.5 && pos[i * 3 + 1]! > top) {
      top = pos[i * 3 + 1]!;
      crown[0] = pos[i * 3]!;
      crown[1] = top;
      crown[2] = pos[i * 3 + 2]! - 0.012;
    }
  }

  const out: number[] = [];
  const shade: number[] = [];
  let strands = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const ia = idx[t]!, ib = idx[t + 1]!, ic = idx[t + 2]!;
    const w = (hair[ia]! + hair[ib]! + hair[ic]!) / 3;
    if (w < 0.2) continue;
    const ax = pos[ia * 3]!, ay = pos[ia * 3 + 1]!, az = pos[ia * 3 + 2]!;
    const e1 = [pos[ib * 3]! - ax, pos[ib * 3 + 1]! - ay, pos[ib * 3 + 2]! - az];
    const e2 = [pos[ic * 3]! - ax, pos[ic * 3 + 1]! - ay, pos[ic * 3 + 2]! - az];
    const cross = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const areaCm2 = 0.5 * Math.hypot(cross[0]!, cross[1]!, cross[2]!) * 1e4;
    const expected = areaCm2 * p.density * w;
    let n = Math.floor(expected);
    if (rnd() < expected - n) n++;
    for (let s = 0; s < n; s++) {
      let u = rnd(), v = rnd();
      if (u + v > 1) [u, v] = [1 - u, 1 - v];
      const ba = 1 - u - v;
      const root = [0, 1, 2].map((k) => ba * pos[ia * 3 + k]! + u * pos[ib * 3 + k]! + v * pos[ic * 3 + k]!);
      const normal = norm([0, 1, 2].map((k) => ba * nor[ia * 3 + k]! + u * nor[ib * 3 + k]! + v * nor[ic * 3 + k]!));
      // fluxo na superfície: afastando da coroa, projetado no plano tangente
      const d = [root[0]! - crown[0]!, root[1]! - crown[1]!, root[2]! - crown[2]!];
      const dn = d[0]! * normal[0]! + d[1]! * normal[1]! + d[2]! * normal[2]!;
      const flow = norm([d[0]! - normal[0]! * dn, d[1]! - normal[1]! * dn, d[2]! - normal[2]! * dn]);
      // Cabelo mais comprido no topo; nas laterais e na nuca (mais de ~3 cm abaixo do topo) fica bem mais curto.
      const topFactor = 0.4 + 0.6 * smooth(top - 0.075, top - 0.025, root[1]!);
      let len = p.length * topFactor * (0.8 + rnd() * 0.4);
      if (p.eyeY !== undefined && p.faceZ !== undefined && root[2]! > p.faceZ - 0.02) {
        len = Math.min(len, Math.max(0.01, (root[1]! - (p.eyeY + 0.04)) / 0.7)); // franja curta: termina acima da sobrancelha
      }
      const step = len / segs;
      let dir = norm([normal[0]! * 0.32 + flow[0]! * 0.5, normal[1]! * 0.32 + flow[1]! * 0.5, normal[2]! * 0.32 + flow[2]! * 0.5]);
      const tone = 0.7 + rnd() * 0.4;
      const wig = [(rnd() - 0.5) * 0.18, (rnd() - 0.5) * 0.18, (rnd() - 0.5) * 0.18];
      let cur = root;
      for (let k = 0; k < segs; k++) {
        const fall = 0.24 + 0.4 * (k / segs); // a gravidade pesa mais perto da ponta
        dir = norm([
          dir[0]! + flow[0]! * 0.08 + wig[0]!,
          dir[1]! - fall + wig[1]!,
          dir[2]! + flow[2]! * 0.08 + wig[2]!,
        ]);
        const next = [cur[0]! + dir[0]! * step, cur[1]! + dir[1]! * step, cur[2]! + dir[2]! * step];
        out.push(cur[0]!, cur[1]!, cur[2]!, next[0]!, next[1]!, next[2]!);
        const t0 = tone * (0.85 + 0.25 * (k / segs));
        shade.push(t0, t0);
        cur = next;
      }
      strands++;
    }
  }
  return { positions: new Float32Array(out), shade: new Float32Array(shade), strands, segments: segs };
}
