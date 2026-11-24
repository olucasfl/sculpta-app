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
  /** Recebe cada fio inteiro (do couro cabeludo à ponta). */
  onStrand?: (s: StrandPath) => void;
}

/** Caminho de um fio (do couro cabeludo à ponta), para montar mechas. */
export interface StrandPath {
  pts: number[][];
  /** Cor lida da foto (linear), ou null. */
  rgb: [number, number, number] | null;
  len: number;
  /** 1 no alto da cabeça, 0 nas laterais baixas. */
  tHigh: number;
  front: boolean;
}

/** Cabeça aproximada usada na colisão (elipsoide da calota e cilindros do maxilar e do pescoço). */
export interface HeadShape {
  hx: number;
  hy: number;
  hz: number;
  cy: number;
  cz: number;
  yb: number;
  top: number;
}

export interface StrandStyle {
  /** Comprimentos em metros: no alto da cabeça, nas laterais e na nuca. */
  top: number;
  side: number;
  back: number;
  /** Comprimento (m) dos fios da franja; sem ele valem os comprimentos do alto da cabeça. */
  fringeLen?: number;
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
  /** 0 a 1: ondulado (ondas largas, estilo cabelo ondulado). */
  wave?: number;
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
  head: HeadShape;
  /** Vértice da cabeça mais próximo de um ponto e a distância até ele (m); índice −1 se nenhum está perto. */
  attach: (q: number[]) => [number, number];
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
export function orientationField(img: PhotoImage, radius = 10) {
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
  const density = p.density * (st ? Math.max(0.4, 1 - maxLen * 1.1) : 1);
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
  // Grade espacial dos vértices da cabeça: os fios param na superfície REAL (não num elipsoide) e, se curtos, deitam nela.
  const CELL = 0.018;
  const gkey = (x: number, y: number, z: number) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
  const grid = new Map<number, number[]>();
  for (let i = 0; i < nv; i++) {
    const k = gkey(Math.floor(pos[i * 3]! / CELL), Math.floor(pos[i * 3 + 1]! / CELL), Math.floor(pos[i * 3 + 2]! / CELL));
    const cellList = grid.get(k);
    if (cellList) cellList.push(i);
    else grid.set(k, [i]);
  }
  const nearest = (q: number[]) => {
    const cx0 = Math.floor(q[0]! / CELL), cy0 = Math.floor(q[1]! / CELL), cz0 = Math.floor(q[2]! / CELL);
    let best = -1, bd = 0.045 * 0.045;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const list = grid.get(gkey(cx0 + dx, cy0 + dy, cz0 + dz));
      if (!list) continue;
      for (const i of list) {
        const d2 = (pos[i * 3]! - q[0]!) ** 2 + (pos[i * 3 + 1]! - q[1]!) ** 2 + (pos[i * 3 + 2]! - q[2]!) ** 2;
        if (d2 < bd) { bd = d2; best = i; }
      }
    }
    return best;
  };
  // Orelhas: as mais salientes de cada lado, na faixa de altura entre os olhos e o nariz. O cabelo passa ATRÁS delas.
  const ears: { sx: number; cx: number; cy: number; cz: number; ry: number; rz: number }[] = [];
  for (const sx of [-1, 1]) {
    let maxX = -Infinity;
    const inBand = (i: number) =>
      sx * pos[i * 3]! > 0.05 && pos[i * 3 + 1]! > eyeLevel - 0.08 && pos[i * 3 + 1]! < eyeLevel + 0.03 && pos[i * 3 + 2]! < cz + 0.02;
    for (let i = 0; i < nv; i++) if (inBand(i)) maxX = Math.max(maxX, sx * pos[i * 3]!);
    if (!Number.isFinite(maxX)) continue;
    let n = 0, mx = 0, my = 0, mz = 0, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < nv; i++) {
      if (!inBand(i) || sx * pos[i * 3]! < maxX - 0.022) continue;
      n++;
      mx += pos[i * 3]!; my += pos[i * 3 + 1]!; mz += pos[i * 3 + 2]!;
      y0 = Math.min(y0, pos[i * 3 + 1]!); y1 = Math.max(y1, pos[i * 3 + 1]!);
      z0 = Math.min(z0, pos[i * 3 + 2]!); z1 = Math.max(z1, pos[i * 3 + 2]!);
    }
    if (n < 6) continue;
    ears.push({ sx, cx: mx / n, cy: my / n, cz: mz / n, ry: Math.max(0.05, (y1 - y0) / 2 + 0.038), rz: Math.max(0.038, (z1 - z0) / 2 + 0.026) });
  }
  let inFringe = false;
  const collide = (q: number[], off: number, stick: number) => {
    for (const e of ears) {
      if (e.sx * q[0]! < Math.abs(e.cx) - 0.045) continue; // só do lado de fora da cabeça
      const dd = Math.hypot((q[1]! - e.cy) / e.ry, (q[2]! - e.cz) / e.rz);
      if (dd < 1) {
        const k = 1 - dd * dd;
        q = [q[0]!, q[1]!, q[2]! + (e.cz - e.rz * 1.05 - q[2]!) * k]; // desliza para trás da orelha
      }
    }
    // o cabelo não cai na frente do rosto: ao lado dele
    if (!inFringe && p.faceZ !== undefined && q[1]! < eyeLevel + 0.045 && q[2]! > p.faceZ - 0.008 && Math.abs(q[0]!) < hx * 0.9) {
      q = [(q[0]! >= 0 ? 1 : -1) * hx * 0.9, q[1]!, q[2]!];
    }
    const i = nearest(q);
    if (i < 0) return q;
    const n = [nor[i * 3]!, nor[i * 3 + 1]!, nor[i * 3 + 2]!];
    const h = (q[0]! - pos[i * 3]!) * n[0]! + (q[1]! - pos[i * 3 + 1]!) * n[1]! + (q[2]! - pos[i * 3 + 2]!) * n[2]!;
    let move = 0;
    if (h < off) move = off - h; // nunca dentro da cabeça
    else if (stick > 0 && h < off + 0.035) move = -(h - off) * stick; // curto: deita na superfície
    return [q[0]! + n[0]! * move, q[1]! + n[1]! * move, q[2]! + n[2]! * move];
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
      if (st) {
        // perto da coroa o fluxo radial não tem direção (vira tufo): ali o cabelo vai para trás, e a transição é suave
        const rw = smooth(0, 0.045, Math.hypot(d[0]!, d[2]!));
        flow = norm([flow[0]! * rw, flow[1]! * rw, flow[2]! * rw - (1 - rw)]);
      }
      let ru = 0;
      let rv = 0;
      if (field && p.uv && p.photo) {
        ru = ba * p.uv[ia * 2]! + u * p.uv[ib * 2]! + v * p.uv[ic * 2]!;
        rv = ba * p.uv[ia * 2 + 1]! + u * p.uv[ib * 2 + 1]! + v * p.uv[ic * 2 + 1]!;
        if (pu && pv && p.photoDirection !== false) {
          const cx = Math.min(field.w - 1, Math.max(0, Math.floor(ru * field.w)));
          const cy = Math.min(field.h - 1, Math.max(0, Math.floor(rv * field.h)));
          const ang = field.angle[cy * field.w + cx]!;
          const coh = smooth(0.3, 0.8, field.coherence[cy * field.w + cx]!); // só onde a foto mostra uma direção clara
          const t3 = norm([0, 1, 2].map((k) => Math.cos(ang) * pu![k]! + Math.sin(ang) * pv![k]!));
          const ref = [flow[0]!, flow[1]! - 0.6, flow[2]!];
          const sgn = t3[0]! * ref[0]! + t3[1]! * ref[1]! + t3[2]! * ref[2]! < 0 ? -1 : 1;
          const tn = (t3[0]! * normal[0]! + t3[1]! * normal[1]! + t3[2]! * normal[2]!) * sgn;
          const tt = [sgn * t3[0]! - normal[0]! * tn, sgn * t3[1]! - normal[1]! * tn, sgn * t3[2]! - normal[2]! * tn];
          const mix = 0.55 * coh; // onde a foto não mostra direção clara, vale o fluxo a partir da coroa
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
        if (st.part) mixTo(norm([Math.tanh((root[0]! - (st.partX ?? 0)) / 0.012), -0.1, -0.3]), st.part * (0.3 + 0.7 * tHigh));
        if (front) {
          // franja de lado: cai sobre a testa só no lado em que ela pesa; do outro lado o cabelo fica penteado para cima
          let pf = st.fringe;
          if (st.sweep) {
            const heavy = smooth(-0.02, 0.03, Math.sign(st.sweep) * root[0]!);
            pf = Math.min(1, st.fringe * 1.8) * heavy + 0.08 * (1 - heavy);
          }
          fringeStrand = rnd() < pf;
          // sem franja, a frente é penteada para trás e para os lados (separada na risca, se houver)
          if (!fringeStrand) flow = norm([Math.tanh((root[0]! - (st.partX ?? 0)) / 0.012) * 0.8, -0.15, -0.55]);
          // franja de lado: os fios da franja atravessam a testa em diagonal, para o lado do `sweep`
          else if (st.sweep) mixTo(norm([Math.sign(st.sweep), -0.4, 0.12]), Math.min(0.85, Math.abs(st.sweep)));
        }
        const base = root[2]! < cz - 0.015 ? st.back : st.side;
        len = (base + (st.top - base) * tHigh) * (0.92 + rnd() * 0.16);
      } else {
        // Cabelo mais comprido no topo; nas laterais e na nuca (mais de ~3 cm abaixo do topo) fica bem mais curto.
        len = p.length * (0.4 + 0.6 * tHigh) * (0.8 + rnd() * 0.4);
      }
      if (st?.fringeLen && front && fringeStrand) len = st.fringeLen * (0.92 + rnd() * 0.16);
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
      // curva natural: fios vizinhos oscilam juntos (fase comum pela posição da raiz) com pequena diferença própria
      const wavePhase = root[0]! * 38 + root[2]! * 24 + root[1]! * 12 + (rnd() - 0.5) * 1.4;
      const waveAmp = st ? Math.max(st.wave ?? 0, 0.12) : 0;
      const off = 0.003 + 0.006 * rnd() + 0.012 * puff; // espessura do cabelo sobre a pele
      const shortness = Math.max(0, Math.min(1, 1 - len / 0.1)) * 0.85;
      const tone = 0.7 + rnd() * 0.4;
      // mechas: fios vizinhos (célula de ~4 mm) compartilham o desvio, com um pouco de ruído próprio
      const cell = hash3(Math.floor(root[0]! / 0.004), Math.floor(root[1]! / 0.004), Math.floor(root[2]! / 0.004));
      const wigAmp = (0.05 + 0.1 * Math.min(1, curl + lift)) * (len > 0.1 ? 1.5 : 1);
      const wig = [(cell[0]! - 0.5) * wigAmp + (rnd() - 0.5) * 0.015, (cell[1]! - 0.5) * wigAmp * 0.25, (cell[2]! - 0.5) * wigAmp + (rnd() - 0.5) * 0.015];
      let strandRgb: [number, number, number] | null = null;
      if (p.photo && p.base) {
        const c = sampleRgb(p.photo, ru, rv);
        const mixC = p.colorMix ?? 0.6;
        strandRgb = [0, 1, 2].map((k) => Math.min(1, c[k]! * mixC + p.base![k]! * (1 - mixC))) as [number, number, number];
      }
      let cur = root;
      const pts: number[][] = p.onStrand ? [root] : [];
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
        if (waveAmp > 0 && len > 0.02) {
          const lat = norm([dir[2]!, 0, -dir[0]!]); // lateral ao fio, na horizontal
          const ph = wavePhase + (2 * Math.PI * step * (k + 1)) / 0.075;
          const ramp = Math.min(1, (k + 1) / (segs * 0.3));
          sd = norm([0, 1, 2].map((q) => sd[q]! + lat[q]! * waveAmp * 0.9 * ramp * Math.cos(ph)));
        }
        let next = [cur[0]! + sd[0]! * step, cur[1]! + sd[1]! * step, cur[2]! + sd[2]! * step];
        if (st) {
          inFringe = fringeStrand && front;
          const stick = Math.max(shortness, 0.6 * Math.max(0, 1 - (2 * (k + 1)) / segs));
          next = collide(next, off, stick);
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
        if (p.onStrand) pts.push(next);
      }
      p.onStrand?.({ pts, rgb: strandRgb, len, tHigh, front: front && fringeStrand });
      strands++;
    }
  }
  return {
    positions: new Float32Array(out),
    shade: new Float32Array(shade),
    strands,
    segments: segs,
    colors: colorsOut.length ? new Float32Array(colorsOut) : undefined,
    head: { hx, hy, hz, cy, cz, yb, top },
    attach: (q) => {
      const i = nearest(q);
      return i < 0 ? [-1, Infinity] : [i, Math.hypot(pos[i * 3]! - q[0]!, pos[i * 3 + 1]! - q[1]!, pos[i * 3 + 2]! - q[2]!)];
    },
  };
}
