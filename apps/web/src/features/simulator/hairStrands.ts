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
  /** Textura das fotos (RGBA) e UVs da malha: dão a cor de cada fio e a direção em que o cabelo cai na foto. */
  photo?: PhotoImage;
  uv?: ArrayLike<number>;
  /** Cor média do cabelo (0 a 1 por canal), usada para firmar a cor lida da foto. */
  base?: [number, number, number];
}

export interface PhotoImage {
  rgba: ArrayLike<number>;
  w: number;
  h: number;
}

export interface Strands {
  /** Cor (RGB, 0 a 1) por vértice de segmento, lida da foto; presente só quando há `photo`. */
  colors?: Float32Array;
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


/** Campo de orientação (tensor de estrutura): direção dos fios (sem sentido) e o quanto ela é confiável (0 a 1). */
export function orientationField(img: PhotoImage, radius = 5) {
  const { w, h, rgba } = img;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!;
  const jxx = new Float32Array(w * h);
  const jyy = new Float32Array(w * h);
  const jxy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = lum[i + 1]! - lum[i - 1]!;
      const gy = lum[i + w]! - lum[i - w]!;
      jxx[i] = gx * gx;
      jyy[i] = gy * gy;
      jxy[i] = gx * gy;
    }
  }
  const blur = (a: Float32Array) => {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    const k = 2 * radius + 1;
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -radius; x <= radius; x++) acc += a[y * w + Math.min(w - 1, Math.max(0, x))]!;
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / k;
        acc += a[y * w + Math.min(w - 1, x + radius + 1)]! - a[y * w + Math.max(0, x - radius)]!;
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -radius; y <= radius; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!;
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / k;
        acc += tmp[Math.min(h - 1, y + radius + 1) * w + x]! - tmp[Math.max(0, y - radius) * w + x]!;
      }
    }
    return out;
  };
  const bxx = blur(jxx);
  const byy = blur(jyy);
  const bxy = blur(jxy);
  const angle = new Float32Array(w * h);
  const coherence = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const d = bxx[i]! - byy[i]!;
    angle[i] = 0.5 * Math.atan2(2 * bxy[i]!, d) + Math.PI / 2; // o fio corre perpendicular ao gradiente
    coherence[i] = Math.hypot(d, 2 * bxy[i]!) / (bxx[i]! + byy[i]! + 1e-6);
  }
  return { w, h, angle, coherence };
}

function sampleRgb(img: PhotoImage, u: number, v: number): [number, number, number] {
  const x = Math.min(img.w - 1, Math.max(0, Math.floor(u * img.w)));
  const y = Math.min(img.h - 1, Math.max(0, Math.floor(v * img.h)));
  const i = (y * img.w + x) * 4;
  return [img.rgba[i]! / 255, img.rgba[i + 1]! / 255, img.rgba[i + 2]! / 255];
}

const hash3 = (x: number, y: number, z: number) => {
  const r = mulberry32((x * 73856093) ^ (y * 19349663) ^ (z * 83492791));
  return [r(), r(), r()];
};

const SPEC_HALF = [0, 0.55, 0.83]; // meio-vetor fixo (luz de cima e da frente) para o brilho do fio

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

  const field = p.photo && p.uv ? orientationField(p.photo) : null;
  const colorsOut: number[] = [];
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
    // direção do cabelo lida da foto, levada ao 3D pelas derivadas das coordenadas de textura deste triângulo
    let pu: number[] | null = null;
    let pv: number[] | null = null;
    if (field && p.uv) {
      const uv = p.uv;
      const du1 = uv[ib * 2]! - uv[ia * 2]!;
      const dv1 = uv[ib * 2 + 1]! - uv[ia * 2 + 1]!;
      const du2 = uv[ic * 2]! - uv[ia * 2]!;
      const dv2 = uv[ic * 2 + 1]! - uv[ia * 2 + 1]!;
      const det = du1 * dv2 - du2 * dv1;
      if (Math.abs(det) > 1e-10 && Math.max(Math.abs(du1), Math.abs(du2), Math.abs(dv1), Math.abs(dv2)) < 0.1) {
        pu = [0, 1, 2].map((k) => (e1[k]! * dv2 - e2[k]! * dv1) / det);
        pv = [0, 1, 2].map((k) => (e2[k]! * du1 - e1[k]! * du2) / det);
      }
    }
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
      let flow = norm([d[0]! - normal[0]! * dn, d[1]! - normal[1]! * dn, d[2]! - normal[2]! * dn]);
      let ru = 0;
      let rv = 0;
      if (field && p.uv && p.photo) {
        ru = ba * p.uv[ia * 2]! + u * p.uv[ib * 2]! + v * p.uv[ic * 2]!;
        rv = ba * p.uv[ia * 2 + 1]! + u * p.uv[ib * 2 + 1]! + v * p.uv[ic * 2 + 1]!;
        if (pu && pv) {
          const cx = Math.min(field.w - 1, Math.max(0, Math.floor(ru * field.w)));
          const cy = Math.min(field.h - 1, Math.max(0, Math.floor(rv * field.h)));
          const ang = field.angle[cy * field.w + cx]!;
          const coh = Math.min(1, field.coherence[cy * field.w + cx]! * 1.4);
          const t3 = norm([0, 1, 2].map((k) => Math.cos(ang) * pu![k]! + Math.sin(ang) * pv![k]!));
          const ref = [flow[0]!, flow[1]! - 0.6, flow[2]!];
          const sgn = t3[0]! * ref[0]! + t3[1]! * ref[1]! + t3[2]! * ref[2]! < 0 ? -1 : 1;
          const tn = (t3[0]! * normal[0]! + t3[1]! * normal[1]! + t3[2]! * normal[2]!) * sgn;
          const tt = [sgn * t3[0]! - normal[0]! * tn, sgn * t3[1]! - normal[1]! * tn, sgn * t3[2]! - normal[2]! * tn];
          const mix = 0.75 * coh; // onde a foto não mostra direção clara, vale o fluxo a partir da coroa
          flow = norm([0, 1, 2].map((k) => flow[k]! * (1 - mix) + tt[k]! * mix));
        }
      }
      // Cabelo mais comprido no topo; nas laterais e na nuca (mais de ~3 cm abaixo do topo) fica bem mais curto.
      const topFactor = 0.4 + 0.6 * smooth(top - 0.075, top - 0.025, root[1]!);
      let len = p.length * topFactor * (0.8 + rnd() * 0.4);
      if (p.eyeY !== undefined && p.faceZ !== undefined && root[2]! > p.faceZ - 0.02) {
        len = Math.min(len, Math.max(0.01, (root[1]! - (p.eyeY + 0.04)) / 0.7)); // franja curta: termina acima da sobrancelha
      }
      const step = len / segs;
      let dir = norm([normal[0]! * 0.32 + flow[0]! * 0.5, normal[1]! * 0.32 + flow[1]! * 0.5, normal[2]! * 0.32 + flow[2]! * 0.5]);
      const tone = 0.7 + rnd() * 0.4;
      // mechas: fios vizinhos (célula de ~4 mm) compartilham o desvio, com um pouco de ruído próprio
      const cell = hash3(Math.floor(root[0]! / 0.004), Math.floor(root[1]! / 0.004), Math.floor(root[2]! / 0.004));
      const wig = [0, 1, 2].map((k) => (cell[k]! - 0.5) * 0.2 + (rnd() - 0.5) * 0.05);
      let strandRgb: [number, number, number] | null = null;
      if (p.photo && p.base) {
        const c = sampleRgb(p.photo, ru, rv);
        strandRgb = [0, 1, 2].map((k) => Math.min(1, c[k]! * 0.6 + p.base![k]! * 0.4)) as [number, number, number];
      }
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
        if (strandRgb) {
          // brilho tipo Kajiya-Kay: forte quando o fio é perpendicular ao meio-vetor da luz
          const th = dir[0]! * SPEC_HALF[0]! + dir[1]! * SPEC_HALF[1]! + dir[2]! * SPEC_HALF[2]!;
          const spec = Math.pow(Math.sqrt(Math.max(0, 1 - th * th)), 18) * 0.35;
          const g0 = tone * (0.7 + 0.35 * (k / segs));
          const g1 = tone * (0.7 + 0.35 * ((k + 1) / segs));
          for (const g of [g0, g1]) {
            colorsOut.push(Math.min(1, strandRgb[0] * g + spec), Math.min(1, strandRgb[1] * g + spec), Math.min(1, strandRgb[2] * g + spec));
          }
        }
        cur = next;
      }
      strands++;
    }
  }
  return {
    positions: new Float32Array(out),
    shade: new Float32Array(shade),
    strands,
    segments: segs,
    colors: colorsOut.length ? new Float32Array(colorsOut) : undefined,
  };
}
