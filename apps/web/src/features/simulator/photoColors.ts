/**
 * Cores a partir da foto frontal e dos 478 pontos do MediaPipe (guardados na captura): tom de pele (bochechas e
 * testa), cor da íris e cor do cabelo (faixa logo acima da testa). Tudo é amostragem simples (mediana), sem IA:
 * serve de ponto de partida que o profissional corrige à mão. Luz colorida, maquiagem, chapéu e fundo claro
 * enganam a amostragem; por isso o cabelo é recusado quando a faixa se parece com pele ou com fundo.
 */
export interface RgbaImage {
  data: ArrayLike<number>;
  width: number;
  height: number;
}
/** Ponto normalizado (0–1) como o MediaPipe entrega. */
export type Landmark = readonly [number, number, number];

type Rgb = [number, number, number];

const LM = { forehead: 10, chin: 152, cheekR: 50, cheekL: 280, foreheadMid: 9, irisR: 468, irisRedge: 469, irisL: 473, irisLedge: 474 } as const;

const toHex = ([r, g, b]: Rgb) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const luma = ([r, g, b]: Rgb) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

function disc(img: RgbaImage, cx: number, cy: number, r: number): Rgb[] {
  const out: Rgb[] = [];
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(img.width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(img.height - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = (y * img.width + x) * 4;
      out.push([img.data[i]!, img.data[i + 1]!, img.data[i + 2]!]);
    }
  }
  return out;
}

function median(pixels: Rgb[]): Rgb | null {
  if (pixels.length === 0) return null;
  const ch = (k: 0 | 1 | 2) => {
    const v = pixels.map((p) => p[k]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)]!;
  };
  return [ch(0), ch(1), ch(2)];
}

const dist = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export interface PhotoColors {
  skinHex?: string;
  irisHex?: string;
  hairHex?: string;
  /** O que não deu para tirar da foto, com o motivo (para avisar o usuário). */
  notes: string[];
}

export function colorsFromPhoto(img: RgbaImage, lm: readonly Landmark[]): PhotoColors {
  const notes: string[] = [];
  if (lm.length < 478) return { notes: ['A foto não tem os pontos do rosto necessários.'] };
  const px = (i: number): [number, number] => [lm[i]![0] * img.width, lm[i]![1] * img.height];
  const faceH = Math.abs(px(LM.chin)[1] - px(LM.forehead)[1]);
  const result: PhotoColors = { notes };

  // Pele: bochechas e meio da testa.
  const skinPixels = [LM.cheekR, LM.cheekL, LM.foreheadMid].flatMap((i) => {
    const [x, y] = px(i);
    return disc(img, x, y, Math.max(3, faceH * 0.03));
  });
  const skin = median(skinPixels);
  if (skin) result.skinHex = toHex(skin);
  else notes.push('Não consegui ler a pele.');

  // Íris: miolo entre a pupila e o brilho, nos dois olhos.
  const irisPixels = ([[LM.irisR, LM.irisRedge], [LM.irisL, LM.irisLedge]] as const).flatMap(([c, e]) => {
    const [cx, cy] = px(c);
    const [ex, ey] = px(e);
    const r = Math.hypot(cx - ex, cy - ey);
    return disc(img, cx, cy, r * 0.8).filter((p) => luma(p) > 0.1 && luma(p) < 0.9);
  });
  const iris = median(irisPixels);
  if (iris && irisPixels.length >= 12) result.irisHex = toHex(iris);
  else notes.push('Não consegui ler a íris (olho fechado, reflexo ou resolução baixa).');

  // Cabelo: faixa logo acima da testa; recusa o que parece pele ou fundo claro.
  const [fx, fy] = px(LM.forehead);
  const hairPixels = disc(img, fx, fy - faceH * 0.2, Math.max(4, faceH * 0.07));
  const kept = hairPixels.filter((p) => (!skin || dist(p, skin) > 55) && luma(p) < 0.7);
  if (hairPixels.length > 0 && kept.length / hairPixels.length >= 0.5) {
    const hair = median(kept);
    if (hair) result.hairHex = toHex(hair);
  } else {
    notes.push('Não achei cabelo acima da testa (pouco cabelo, boné ou fundo claro). Escolha a cor à mão.');
  }
  return result;
}
