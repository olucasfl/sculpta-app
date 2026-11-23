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
  /** Estilo (comprimentos por zona, franja, cacho). Sem ele vale o modo antigo: `length` único. */
  style?: StrandStyle;
  /** Usa a direção dos fios lida da foto (padrão sim). Desligue ao aplicar um modelo pronto. */
  photoDirection?: boolean;
  /** Peso da cor lida da foto sobre a cor base, de 0 a 1 (padrão 0,6). */
  colorMix?: number;
}

export interface StrandStyle {
  /** Comprimentos em metros: no alto da cabeça, nas laterais e na nuca. */
  top: number;
  side: number;
  back: number;
  /** 0 a 1: parte dos fios da frente que cai sobre a testa (o resto é penteado para trás e para os lados). */
  fringe: number;
  /** 0 (liso) a 1 (cacheado). */
  curl: number;
  /** 0 a 1: cabelo que fica em pé, volumoso (menos gravidade). */
  puff: number;
  /** 0 a 1: força da risca (os fios se separam dos dois lados dela) e posição dela em metros (+ = lado +x). */
  part?: number;
  partX?: number;
  /** -1 a 1: o cabelo do alto é jogado para o lado (+ = lado +x), como uma franja de lado. */
  sweep?: number;
  /** 0 a 1: penteado para trás. */
  comb?: number;
  /** 0 a 1: cabelo levantado no alto (topete, arrepiado). */
  lift?: number;
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
  // a textura está em sRGB; as cores de vértice do three são lineares
  return [(img.rgba[i]! / 255) ** 2.2, (img.rgba[i + 1]! / 255) ** 2.2, (img.rgba[i + 2]! / 255) ** 2.2];
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
  const st = p.style;
  const maxLen = st ? Math.max(st.top, st.side, st.back) : p.length;
  const segs = p.segments ?? (st ? (st.curl > 0.4 ? 12 : Math.max(6, Math.min(14, Math.round(maxLen * 70)))) : 6);
  const rnd = mulberry32(p.seed ?? 1);
  // cabelo comprido tem muito mais segmentos por fio: menos fios dão o mesmo efeito e pesam menos
  const density = p.density * (st ? Math.max(0.35, 1 - maxLen * 1.2) : 1);
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

  // Cabeça aproximada (elipsoide da calota + cilindros do maxilar e do pescoço): os fios não entram nela.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < nv; i++) {
    if (hair[i]! <= 0.5) continue;
    minX = Math.min(minX, pos[i * 3]!); maxX = Math.max(maxX, pos[i * 3]!);
    minZ = Math.min(minZ, pos[i * 3 + 2]!); maxZ = Math.max(maxZ, pos[i * 3 + 2]!);
  }
  const eyeLevel = p.eyeY ?? top - 0.12;
  const yb = eyeLevel - 0.03;
  const hx = Math.max(Math.abs(minX), Math.abs(maxX)) + 0.004;
  const cz = Number.isFinite(minZ) ? (minZ + maxZ) / 2 : 0;
  const hz = Number.isFinite(minZ) ? (maxZ - minZ) / 2 + 0.004 : 0.09;
  const cy = (top + yb) / 2;
  const hy = (top - yb) / 2 + 0.004;
  let inFringe = false;
  const collide = (q: number[]) => {
    const ex = q[0]! / hx, ey = (q[1]! - cy) / hy, ez = (q[2]! - cz) / hz;
    const e = ex * ex + ey * ey + ez * ez;
    if (e < 1.04 && q[1]! > yb - 0.02) {
      const f = Math.sqrt(1.04 / Math.max(e, 1e-6));
      q = [q[0]! * f, cy + (q[1]! - cy) * f, cz + (q[2]! - cz) * f];
    }
    if (!inFringe && p.faceZ !== undefined && q[1]! < eyeLevel + 0.045 && q[2]! > p.faceZ - 0.008 && Math.abs(q[0]!) < hx * 0.9) {
      q = [(q[0]! >= 0 ? 1 : -1) * hx * 0.9, q[1]!, q[2]!]; // o cabelo cai ao lado do rosto, não na frente dele
    }
    if (q[1]! < yb + 0.01) {
      const rc = q[1]! > yb - 0.11 ? hx * 0.82 : hx * 0.5; // maxilar, depois pescoço
      const dx = q[0]!, dz = q[2]! - cz - 0.005;
      const r = Math.hypot(dx, dz);
      if (r < rc) {
        const f = rc / Math.max(r, 1e-6);
        q = [dx * f, q[1]!, cz + 0.005 + dz * f];
      }
    }
    return q;
  };

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
    let expected = areaCm2 * density * w;
    if (st && st.fringe > 0.4 && p.faceZ !== undefined) {
      // franja cheia: mais fios na linha do cabelo da frente, para cobrir a testa
      const tz = (az + pos[ib * 3 + 2]! + pos[ic * 3 + 2]!) / 3;
      const tx = (ax + pos[ib * 3]! + pos[ic * 3]!) / 3;
      const ty = (ay + pos[ib * 3 + 1]! + pos[ic * 3 + 1]!) / 3;
      if (tz > p.faceZ - 0.05 && Math.abs(tx) < hx * 0.8 && ty > eyeLevel + 0.05) expected *= 1 + 2 * st.fringe;
    }
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
        if (pu && pv && p.photoDirection !== false) {
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
      // frente: a linha do cabelo fica um pouco atrás do plano dos olhos; as têmporas (|x| grande) não são franja
      const front = (p.faceZ !== undefined ? root[2]! > p.faceZ - 0.05 : root[2]! > cz + 0.05) && Math.abs(root[0]!) < hx * 0.8;
      const tHigh = smooth(top - 0.075, top - 0.025, root[1]!);
      let fringeStrand = true;
      let len: number;
      const lift = (st?.lift ?? 0) * tHigh;
      if (st) {
        const mixTo = (to: number[], k: number) => {
          flow = norm([0, 1, 2].map((q) => flow[q]! * (1 - k) + to[q]! * k));
        };
        // direções diferentes por estilo: risca, jogado para o lado, penteado para trás
        if (st.sweep) mixTo(norm([Math.sign(st.sweep), -0.1, -0.1]), Math.min(0.9, Math.abs(st.sweep) * (0.3 + 0.7 * tHigh)));
        if (st.comb) mixTo(norm([0, 0.2, -1]), st.comb * (0.2 + 0.8 * tHigh) * 0.9);
        if (st.part) mixTo(norm([root[0]! - (st.partX ?? 0) >= 0 ? 1 : -1, -0.1, -0.3]), st.part * (0.3 + 0.7 * tHigh));
        if (front) {
          fringeStrand = rnd() < st.fringe;
          // sem franja, a frente é penteada para trás e para os lados (separada na risca, se houver)
          if (!fringeStrand) flow = norm([(root[0]! - (st.partX ?? 0) >= 0 ? 1 : -1) * 0.8, -0.15, -0.55]);
        }
        const base = root[2]! < cz - 0.015 ? st.back : st.side;
        len = (base + (st.top - base) * tHigh) * (0.85 + rnd() * 0.3);
      } else {
        // Cabelo mais comprido no topo; nas laterais e na nuca (mais de ~3 cm abaixo do topo) fica bem mais curto.
        len = p.length * (0.4 + 0.6 * tHigh) * (0.8 + rnd() * 0.4);
      }
      if (p.eyeY !== undefined && p.faceZ !== undefined && front && fringeStrand) {
        len = Math.min(len, Math.max(0.01, (root[1]! - (p.eyeY + 0.03)) / 0.6)); // franja: termina acima da sobrancelha
      }
      len = Math.max(len, 0.006);
      const step = len / segs;
      const puff = st?.puff ?? 0;
      const curl = st?.curl ?? 0;
      const nW = 0.32 + 0.5 * puff + 0.5 * lift;
      let dir = norm([normal[0]! * nW + flow[0]! * 0.5, normal[1]! * nW + flow[1]! * 0.5, normal[2]! * nW + flow[2]! * 0.5]);
      const phase0 = rnd() * Math.PI * 2;
      const tone = 0.7 + rnd() * 0.4;
      // mechas: fios vizinhos (célula de ~4 mm) compartilham o desvio, com um pouco de ruído próprio
      const cell = hash3(Math.floor(root[0]! / 0.004), Math.floor(root[1]! / 0.004), Math.floor(root[2]! / 0.004));
      const wigAmp = 0.2 + 0.5 * lift;
      const wig = [0, 1, 2].map((k) => (cell[k]! - 0.5) * wigAmp + (rnd() - 0.5) * 0.05);
      let strandRgb: [number, number, number] | null = null;
      if (p.photo && p.base) {
        const c = sampleRgb(p.photo, ru, rv);
        const mixC = p.colorMix ?? 0.6;
        strandRgb = [0, 1, 2].map((k) => Math.min(1, c[k]! * mixC + p.base![k]! * (1 - mixC))) as [number, number, number];
      }
      let cur = root;
      for (let k = 0; k < segs; k++) {
        // a gravidade pesa mais perto da ponta, e mais nos fios compridos; cabelo volumoso resiste a ela
        const fall = (0.24 + 0.4 * (k / segs)) * (1 + Math.min(len, 0.3) * (st ? 3 : 0)) * (1 - 0.55 * puff) * (1 - 0.8 * lift);
        dir = norm([
          dir[0]! + flow[0]! * 0.08 + wig[0]!,
          dir[1]! - fall + wig[1]!,
          dir[2]! + flow[2]! * 0.08 + wig[2]!,
        ]);
        let sd = dir;
        if (curl > 0.05) {
          // cacho: desvio em hélice em torno da direção do fio (não acumula em `dir`)
          const ax0 = Math.abs(dir[1]!) > 0.9 ? [1, 0, 0] : [0, 1, 0];
          const a = norm([dir[1]! * ax0[2]! - dir[2]! * ax0[1]!, dir[2]! * ax0[0]! - dir[0]! * ax0[2]!, dir[0]! * ax0[1]! - dir[1]! * ax0[0]!]);
          const b = [dir[1]! * a[2]! - dir[2]! * a[1]!, dir[2]! * a[0]! - dir[0]! * a[2]!, dir[0]! * a[1]! - dir[1]! * a[0]!];
          const ph = phase0 + k * (1.7 + 2 * curl);
          const amp = curl * 0.55 * (0.5 + 0.5 * (k / segs));
          sd = norm([0, 1, 2].map((q) => dir[q]! + amp * (a[q]! * Math.cos(ph) + b[q]! * Math.sin(ph))));
        }
        let next = [cur[0]! + sd[0]! * step, cur[1]! + sd[1]! * step, cur[2]! + sd[2]! * step];
        if (st) {
          inFringe = fringeStrand && front;
          next = collide(next);
        }
        out.push(cur[0]!, cur[1]!, cur[2]!, next[0]!, next[1]!, next[2]!);
        const t0 = tone * (0.85 + 0.25 * (k / segs));
        shade.push(t0, t0);
        if (strandRgb) {
          // brilho tipo Kajiya-Kay: forte quando o fio é perpendicular ao meio-vetor da luz
          const th = dir[0]! * SPEC_HALF[0]! + dir[1]! * SPEC_HALF[1]! + dir[2]! * SPEC_HALF[2]!;
          const spec = Math.pow(Math.sqrt(Math.max(0, 1 - th * th)), 40) * 0.07;
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
